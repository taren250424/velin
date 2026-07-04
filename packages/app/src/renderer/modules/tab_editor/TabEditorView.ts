import "@milkdown/theme-nord/style.css"
import { serializerCtx } from "@milkdown/core"
import { Editor, editorViewCtx, parserCtx } from "@milkdown/kit/core"

import { TextSelection, Selection } from "prosemirror-state"
import { Decoration, DecorationSet, EditorView } from "prosemirror-view"
import { Plugin, PluginKey } from "prosemirror-state"
import { redo, undo } from "prosemirror-history"
import type { Node } from "prosemirror-model"

import { CLASS_SELECTED, DATASET_ATTR_TAB_ID } from "../../constants/dom"

type SearchMatch = {
	from: number
	to: number
}

type SearchState = {
	query: string
	matches: SearchMatch[]
	currentIndex: number
	// Doc the matches were computed against; edits make them stale.
	doc: Node
}

type SearchHighlightMeta = {
	matches: SearchMatch[]
	currentIndex: number
} | null

export class TabEditorView {
	private _tabBox: HTMLElement
	private _tabSpan: HTMLElement
	private _tabButton: HTMLElement

	private _editorBox: HTMLElement
	private _editor: Editor | null
	private _isBinary: boolean

	private _onInput?: (view: TabEditorView) => void

	private _suppressInputEvent = false

	private _searchState: SearchState | null = null
	private _searchHighlightKey = new PluginKey<DecorationSet>("searchHighlight")

	constructor(
		tabBox: HTMLElement,
		tabSpan: HTMLElement,
		tabButton: HTMLElement,
		editorBox: HTMLElement,
		editor: Editor | null,
		isBinary: boolean,
		onInput: (view: TabEditorView) => void,
		onBlur: (view: TabEditorView) => void
	) {
		this._tabBox = tabBox
		this._tabSpan = tabSpan
		this._tabButton = tabButton
		this._editorBox = editorBox
		this._editor = editor
		this._isBinary = isBinary
		this._onInput = onInput

		if (!isBinary) this._initEditorObserver(onInput, onBlur)
	}

	//

	_initEditorObserver(onInput: (view: TabEditorView) => void, onBlur: (view: TabEditorView) => void) {
		this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)

			view.setProps({
				dispatchTransaction: (tr) => {
					const newState = view.state.apply(tr)
					view.updateState(newState)

					if (tr.scrolledIntoView) {
						const { from } = newState.selection
						const coords = view.coordsAtPos(from)

						let scrollEl: Element | null = view.dom.parentElement
						while (scrollEl) {
							const { overflowY } = window.getComputedStyle(scrollEl)
							if (overflowY === "auto" || overflowY === "scroll") break
							scrollEl = scrollEl.parentElement
						}

						const target = scrollEl ?? document.documentElement
						const box = target.getBoundingClientRect()
						target.scrollTop = coords.top - box.top + target.scrollTop - target.clientHeight / 2
					}

					if (tr.docChanged) {
						if (this._suppressInputEvent) return
						onInput(this)
					}
				},
				handleDOMEvents: {
					blur: () => {
						onBlur(this)
						return false
					},
				},
			})
		})
	}

	//

	getId(): number {
		return parseInt(this._tabBox.dataset[DATASET_ATTR_TAB_ID]!)
	}

	//

	getEditorFirstLine() {
		const editorView = this._editor!.ctx.get(editorViewCtx)
		const firstLine = editorView.state.doc.textBetween(0, editorView.state.doc.content.size).split("\n")[0].trim()
		return firstLine || "Untitled"
	}

	getContent(): string {
		return this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)
			const serializer = ctx.get(serializerCtx)
			return serializer(view.state.doc)
		})
	}

	setContent(content: string): void {
		this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)
			const parser = ctx.get(parserCtx)
			const doc = parser(content)

			if (doc) {
				const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content)
				view.dispatch(tr)
			}
		})
	}

	//

	undoEditor() {
		this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)
			const { state, dispatch } = view
			undo(state, dispatch)
		})
	}

	redoEditor() {
		this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)
			const { state, dispatch } = view
			redo(state, dispatch)
		})
	}

	pasteInEditor(text: string) {
		this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)
			const { state, dispatch } = view
			view.focus()
			dispatch(state.tr.insertText(text))
		})
	}

	//

	getSelection() {
		return this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)
			const sel = view.state.selection

			return {
				anchor: sel.anchor,
				head: sel.head,
			}
		})
	}

	setSelection(sel: { anchor: number; head: number }) {
		this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)
			const state = view.state

			const maxPos = state.doc.content.size
			const safeAnchor = Math.max(0, Math.min(sel.anchor, maxPos))

			try {
				const resolvedPos = state.doc.resolve(safeAnchor)
				const newSel = Selection.near(resolvedPos)

				const tr = state.tr.setSelection(newSel)
				view.dispatch(tr)
			} catch (e) {
				console.warn("Selection placement failed:", e)
			}
		})
	}

	//

	focus() {
		this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)
			view.focus()
		})
	}

	destroy() {
		this._editor?.destroy()
		this._editorBox.remove()
		this._tabBox.remove()
	}

	//

	setActive() {
		this._editorBox.classList.add(CLASS_SELECTED)
		this._tabBox.classList.add(CLASS_SELECTED)
		this.focus()
	}

	setDeactive() {
		this._editorBox.classList.remove(CLASS_SELECTED)
		this._tabBox.classList.remove(CLASS_SELECTED)
	}

	//

	setTabSpanTextContent(text: string) {
		this._tabSpan.textContent = text
	}

	setTabButtonTextContent(text: string) {
		this._tabButton.textContent = text
	}

	//

	findAllMatches(searchText: string): SearchMatch[] {
		const view = this._editor!.ctx.get(editorViewCtx)
		const { doc } = view.state

		const matches: { from: number; to: number }[] = []

		if (!searchText || !searchText.trim()) {
			return matches
		}

		doc.descendants((node, pos) => {
			if (node.isText) {
				const text = node.text ?? ""
				let index = text.indexOf(searchText)
				while (index !== -1) {
					matches.push({
						from: pos + index,
						to: pos + index + searchText.length,
					})
					index = text.indexOf(searchText, index + searchText.length)
				}
			}
			return true
		})

		return matches
	}

	updateSearchState(state: SearchState | null) {
		this._searchState = state
	}

	searchNextMatch(query: string, direction: "up" | "down"): number {
		const matches = this.findAllMatches(query)
		if (!matches.length) {
			this.clearSearch()
			return -1
		}

		const view = this._editor!.ctx.get(editorViewCtx)
		const state = view.state
		const currentPos = state.selection.from

		let targetIndex = -1

		if (direction === "down") {
			targetIndex = matches.findIndex((match) => match.from > currentPos)
			if (targetIndex === -1) targetIndex = 0
		} else {
			for (let i = matches.length - 1; i >= 0; i--) {
				if (matches[i].to <= currentPos) {
					targetIndex = i
					break
				}
			}
			if (targetIndex === -1) targetIndex = matches.length - 1
		}

		this.updateSearchState({
			query,
			matches,
			currentIndex: targetIndex,
			doc: state.doc,
		})

		this.focusCurrentMatch()
		return targetIndex
	}

	isSearchStateStale(): boolean {
		if (!this._searchState) return true
		const view = this._editor!.ctx.get(editorViewCtx)
		return this._searchState.doc !== view.state.doc
	}

	focusCurrentMatch() {
		if (!this._searchState) return

		const { matches, currentIndex } = this._searchState
		const match = matches[currentIndex]

		const view = this._editor!.ctx.get(editorViewCtx)
		this._ensureSearchHighlightPlugin(view)

		const state = view.state
		const tr = state.tr
			.setSelection(TextSelection.create(state.doc, match.from, match.to))
			.setMeta(this._searchHighlightKey, { matches, currentIndex } satisfies SearchHighlightMeta)
			.scrollIntoView()

		view.dispatch(tr)
	}

	// Registered once per editor; afterwards highlights are driven purely by
	// meta transactions, and doc edits remap them via DecorationSet.map.
	private _ensureSearchHighlightPlugin(view: EditorView) {
		const key = this._searchHighlightKey
		if (key.get(view.state)) return

		const searchHighlightPlugin = new Plugin<DecorationSet>({
			key,
			state: {
				init: () => DecorationSet.empty,
				apply: (tr, old) => {
					const meta = tr.getMeta(key) as SearchHighlightMeta | undefined
					if (meta === undefined) return old.map(tr.mapping, tr.doc)
					if (meta === null || !meta.matches.length) return DecorationSet.empty

					const decorations = meta.matches.map((match, idx) =>
						Decoration.inline(match.from, match.to, {
							class: idx === meta.currentIndex ? "search-highlight-current" : "search-highlight",
						})
					)
					return DecorationSet.create(tr.doc, decorations)
				},
			},
			props: {
				decorations: (state) => key.getState(state),
			},
		})

		const newState = view.state.reconfigure({
			plugins: [...view.state.plugins, searchHighlightPlugin],
		})
		view.updateState(newState)
	}

	replaceCurrentMatch(replaceText: string): boolean {
		if (!this._searchState) return false
		// Matches computed against an older doc must not rewrite arbitrary ranges.
		if (this.isSearchStateStale()) return false

		const { matches, currentIndex } = this._searchState
		if (currentIndex < 0 || currentIndex >= matches.length) return false

		let replaced = false

		this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)
			const state = view.state
			const { from, to } = matches[currentIndex]

			let tr = state.tr.replaceWith(from, to, state.schema.text(replaceText))

			const cursorPos = tr.mapping.map(from) + replaceText.length
			tr = tr.setSelection(TextSelection.create(tr.doc, cursorPos))

			view.dispatch(tr)
			replaced = true
		})

		if (replaced) this.markAsModified()
		return replaced
	}

	replaceAllMatches(searchText: string, replaceText: string): number {
		if (!searchText) return 0

		let replacedCount = 0

		this._editor!.action((ctx) => {
			const view = ctx.get(editorViewCtx)
			const state = view.state

			const matches = this.findAllMatches(searchText)
			if (!matches.length) return

			let tr = state.tr

			// Replace backwards to avoid shifting positional indices for upcoming matches
			for (let i = matches.length - 1; i >= 0; i--) {
				const { from, to } = matches[i]
				tr = tr.replaceWith(from, to, state.schema.text(replaceText))
				replacedCount++
			}

			if (replacedCount > 0) {
				view.dispatch(tr)
				this.markAsModified()
			}
		})

		return replacedCount
	}

	markAsModified() {
		if (this._onInput) {
			this._onInput(this)
		}
	}

	clearSearch() {
		this._searchState = null

		const view = this._editor!.ctx.get(editorViewCtx)
		const decorations = this._searchHighlightKey.getState(view.state)
		if (!decorations || decorations === DecorationSet.empty) return

		view.dispatch(view.state.tr.setMeta(this._searchHighlightKey, null))
	}

	get searchState() {
		return this._searchState
	}

	//

	setSuppressInputEvent(value: boolean) {
		this._suppressInputEvent = value
	}

	shouldSuppressInputEvent(): boolean {
		return this._suppressInputEvent
	}

	//

	get isBinary(): boolean {
		return this._isBinary
	}

	get editor(): Editor | null {
		return this._editor
	}

	get tabBox(): HTMLElement {
		return this._tabBox
	}

	get tabSpan() {
		return this._tabSpan
	}

	get tabButton() {
		return this._tabButton
	}

	get editorBox() {
		return this._editorBox
	}
}
