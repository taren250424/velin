import { inject, injectable } from "inversify"

import type Response from "@shared/types/Response"
import type { TreeDto } from "@shared/dto/TreeDto"
import type { TabEditorDto, TabEditorsDto } from "@shared/dto/TabEditorDto"

import type { ICommand } from "../commands/"
import type { SettingsViewModel } from "../viewmodels/SettingsViewModel"

import { DI, DOM } from "../constants"

import closedFolderSvg from "../assets/icons/closed_folder.svg?raw"
import openedFolderSvg from "../assets/icons/opened_folder.svg?raw"

import { FocusManager } from "../core"
import { TabEditorFacade, TreeFacade, SettingsFacade } from "./index"
import { CreateCommand, DeleteCommand, PasteCommand, RenameCommand } from "../commands"

import { sleep } from "../utils/sleep"

@injectable()
export class CommandManager {
	private undoStack: ICommand[] = []
	private redoStack: ICommand[] = []

	constructor(
		@inject(DI.FocusManager) private readonly focusManager: FocusManager,
		@inject(DI.SettingsFacade) private readonly settingsFacade: SettingsFacade,
		@inject(DI.TabEditorFacade) private readonly tabEditorFacade: TabEditorFacade,
		@inject(DI.TreeFacade) private readonly treeFacade: TreeFacade
	) {}

	//

	performUndoEditor() {
		this.tabEditorFacade.undoEditor()
	}

	async performUndoTree() {
		try {
			window.rendererToMain.setWatchSkipState(true)
			const cmd = this.undoStack.pop()
			if (!cmd) return
			await cmd.undo()
			this.redoStack.push(cmd)
		} catch (err) {
			// Undo failed (e.g., parent copied into child, or src/dest no longer exists).
			// OS/File system may have ignored the operation; we just skip it to avoid breaking the stack.
		} finally {
			await sleep(300)
			window.rendererToMain.setWatchSkipState(false)
		}
	}

	performRedoEditor() {
		this.tabEditorFacade.redoEditor()
	}

	async performRedoTree() {
		try {
			window.rendererToMain.setWatchSkipState(true)
			const cmd = this.redoStack.pop()
			if (!cmd) return
			await cmd.execute()
			this.undoStack.push(cmd)
		} catch (err) {
			// intentionally empty
		} finally {
			await sleep(300)
			window.rendererToMain.setWatchSkipState(false)
		}
	}

	//

	async performNewTab() {
		const response: Response<number> = await window.rendererToMain.newTab()
		if (response.result) await this.tabEditorFacade.addTab(response.data)
	}

	async performOpenFile(filePath?: string) {
		if (filePath) {
			const tabEditorView = this.tabEditorFacade.getTabEditorViewByPath(filePath)
			if (tabEditorView) {
				this.tabEditorFacade.activateTabEditorById(tabEditorView.getId())
				return
			}
		}

		const response: Response<TabEditorDto> = await window.rendererToMain.openFile(filePath)
		if (response.result && response.data) {
			const data = response.data
			await this.tabEditorFacade.addTab(data.id, data.filePath, data.fileName, data.content, data.isBinary)
		}
	}

	async performOpenDirectoryByDialog() {
		const openDirectoryResponse: Response<TreeDto> = await window.rendererToMain.openDirectory()
		if (!openDirectoryResponse.data) return

		const responseViewModel = this.treeFacade.toTreeViewModel(openDirectoryResponse.data)
		this.treeFacade.render(responseViewModel)
		this.treeFacade.setRootTreeViewModel(responseViewModel)

		// Cleanup previous tabs.
		const tabEditorsDto = this.tabEditorFacade.getTabEditorsDto()
		const closeAllTabsResponse = await window.rendererToMain.closeAllTabs(tabEditorsDto)
		if (closeAllTabsResponse.result) this.tabEditorFacade.removeAllTabs(closeAllTabsResponse.data)
	}

	async performOpenDirectoryByTreeNode(treeNode: HTMLElement) {
		const dirPath = treeNode.dataset[DOM.DATASET_ATTR_TREE_PATH]!
		const viewModel = this.treeFacade.getTreeViewModelByPath(dirPath)

		const treeNodeChildren = treeNode.nextElementSibling as HTMLElement
		const treeNodeType = treeNode.querySelector(DOM.SELECTOR_TREE_NODE_TYPE) as HTMLElement

		const previousExpandedStatus = viewModel.expanded
		if (!previousExpandedStatus) {
			if (!viewModel.children?.length) {
				const response: Response<TreeDto> = await window.rendererToMain.openDirectory(viewModel)
				if (!response.data) return

				const newViewModel = this.treeFacade.toTreeViewModel(response.data)

				viewModel.children = newViewModel.children
				this.treeFacade.render(newViewModel, treeNodeChildren)
			}

			if (treeNodeChildren.children.length === 0) {
				this.treeFacade.render(viewModel, treeNodeChildren)
			}
		}

		const nextExpandedStatus = !previousExpandedStatus
		viewModel.expanded = nextExpandedStatus
		treeNodeType.innerHTML = nextExpandedStatus ? openedFolderSvg : closedFolderSvg
		treeNodeChildren.classList.toggle(DOM.CLASS_EXPANDED, nextExpandedStatus)
		if (nextExpandedStatus) this.treeFacade.insertChildNodes(viewModel)
		else this.treeFacade.removeChildNodes(viewModel)
	}

	//

	async performOpenFileOrDirectoryByLastSelectedIndex() {
		const idx = Math.max(this.treeFacade.lastSelectedIndex, 0)
		const viewModel = this.treeFacade.getTreeViewModelByIndex(idx)

		if (viewModel.directory) {
			const treeNode = this.treeFacade.getTreeNodeByIndex(idx)
			await this.performOpenDirectoryByTreeNode(treeNode)
		} else {
			await this.performOpenFile(viewModel.path)
		}

		// Re-focus the tree node to reclaim focus lost to the editor during the opening process.
		const treeNode = this.treeFacade.getTreeNodeByIndex(idx)
		treeNode.focus()
	}

	//

	async performSave() {
		const dto = this.tabEditorFacade.getActiveTabEditorDto()
		if (!dto.isModified) return
		const response: Response<TabEditorDto> = await window.rendererToMain.save(dto)
		if (response.result && !response.data.isModified) this.tabEditorFacade.applySaveResult(response.data)
	}

	async performSaveAs() {
		const dto: TabEditorDto = this.tabEditorFacade.getActiveTabEditorDto()
		const response: Response<TabEditorDto> = await window.rendererToMain.saveAs(dto)
		if (response.result && response.data) {
			this.tabEditorFacade.applySaveResult(response.data)
			await this.tabEditorFacade.addTab(
				response.data.id,
				response.data.filePath,
				response.data.fileName,
				response.data.content,
				response.data.isBinary,
				true
			)
		}
	}

	async performSaveAll() {
		const tabEditorsDto: TabEditorsDto = this.tabEditorFacade.getTabEditorsDto()
		const response: Response<TabEditorsDto> = await window.rendererToMain.saveAll(tabEditorsDto)
		if (response.result) this.tabEditorFacade.applySaveAllResults(response.data)
	}

	//

	async performCloseTab(id: number) {
		const dto = this.tabEditorFacade.getTabEditorDtoById(id)
		const response: Response<void> = await window.rendererToMain.closeTab(dto)
		if (response.result) this.tabEditorFacade.removeTab(dto.id)
		if (this.tabEditorFacade.activeTabId === -1) this.performCloseFindReplaceBox()
	}

	async performCloseOtherTabs() {
		const tabEditorDtoToExclude = this.tabEditorFacade.getTabEditorDtoById(this.tabEditorFacade.contextTabId)
		const tabEditorsDto: TabEditorsDto = this.tabEditorFacade.getTabEditorsDto()
		const response: Response<boolean[]> = await window.rendererToMain.closeOtherTabs(
			tabEditorDtoToExclude,
			tabEditorsDto
		)
		if (response.result) this.tabEditorFacade.removeTabsExcept(response.data)
	}

	async performCloseTabsToRight() {
		const tabEditorDtoAsReference = this.tabEditorFacade.getTabEditorDtoById(this.tabEditorFacade.contextTabId)
		const tabEditorsDto: TabEditorsDto = this.tabEditorFacade.getTabEditorsDto()
		const response: Response<boolean[]> = await window.rendererToMain.closeTabsToRight(
			tabEditorDtoAsReference,
			tabEditorsDto
		)
		if (response.result) this.tabEditorFacade.removeTabsToRight(response.data)
	}

	async performCloseAllTabs() {
		const tabEditorsDto: TabEditorsDto = this.tabEditorFacade.getTabEditorsDto()
		const response: Response<boolean[]> = await window.rendererToMain.closeAllTabs(tabEditorsDto)
		if (response.result) this.tabEditorFacade.removeAllTabs(response.data)
	}

	//

	async performCreate(isDirectory: boolean) {
		const parentInfo = await this._resolveParentDirectory()
		if (!parentInfo) return

		const { idx, viewModel, container } = parentInfo
		
		if (!viewModel.expanded) {
			await this.performOpenDirectoryByTreeNode(this.treeFacade.getTreeNodeByIndex(idx))
		}

		const name = await this._promptForName(container, isDirectory, viewModel.indent)
		if (!name) return

		const cmd = await this._executeCreation(viewModel.path, name, isDirectory)
		const filePath = cmd.getCreatedPath()

		if (filePath) {
			await this._selectTreeNodeAfterCreate(filePath)
			if (!isDirectory) this._openTabEditorAfterCreate(filePath, cmd)
		}
	}

	private async _resolveParentDirectory() {
		let idx = Math.max(this.treeFacade.lastSelectedIndex, 0)
		let viewModel = this.treeFacade.getTreeViewModelByIndex(idx)

		if (!viewModel.directory) {
			idx = this.treeFacade.findParentDirectoryIndex(idx)
			viewModel = this.treeFacade.getTreeViewModelByIndex(idx)
		}

		// If idx is 0 (the root directory), we use the wrapper mapped in TreeRenderer.
		// TreeRenderer maps the root path to simpleBar.getContentElement().
		// Using treeNodeContainer directly would append the input outside SimpleBar's scrollable content.
		const wrapper = this.treeFacade.getTreeWrapperByIndex(idx)
		const container =
			idx === 0
				? wrapper
				: (wrapper.querySelector(DOM.SELECTOR_TREE_NODE_CHILDREN) as HTMLElement)

		return { idx, viewModel, container }
	}

	private _promptForName(container: HTMLElement, isDirectory: boolean, indent: number): Promise<string | null> {
		return new Promise((resolve) => {
			const { wrapper, input } = this.treeFacade.createInput(isDirectory, indent)
			let finished = false

			const cleanup = () => {
				if (finished) return
				finished = true
				input.removeEventListener("keydown", onKeyDown)
				input.removeEventListener("blur", onBlur)
				wrapper.remove()
			}

			const onKeyDown = (e: KeyboardEvent) => {
				if (e.key === "Enter") {
					e.stopPropagation()
					e.preventDefault()
					const value = input.value.trim()
					cleanup()
					resolve(value || null)
				} else if (e.key === "Escape") {
					e.stopPropagation()
					e.preventDefault()
					cleanup()
					resolve(null)
				}
			}

			const onBlur = () => {
				const value = input.value.trim()
				cleanup()
				resolve(value || null)
			}

			container.appendChild(wrapper)
			input.addEventListener("keydown", onKeyDown)
			input.addEventListener("blur", onBlur)
			input.focus()
			input.select()
		})
	}

	private async _executeCreation(parentPath: string, name: string, isDirectory: boolean) {
		const cmd = new CreateCommand(this.treeFacade, this.tabEditorFacade, parentPath, name, isDirectory)

		try {
			window.rendererToMain.setWatchSkipState(true)
			await cmd.execute()
			this.undoStack.push(cmd)
			this.redoStack.length = 0
		} catch (error) {
			// intentionally empty
		} finally {
			await sleep(300)
			window.rendererToMain.setWatchSkipState(false)
		}

		return cmd
	}

	async _selectTreeNodeAfterCreate(filePath: string) {
		this.treeFacade.clearTreeSelected()
		const idx = this.treeFacade.getFlattenIndexByPath(filePath)
		this.treeFacade.addSelectedIndices(idx)
		this.treeFacade.lastSelectedIndex = idx
		const node = this.treeFacade.getTreeNodeByIndex(idx)
		node.classList.add(DOM.CLASS_FOCUSED, DOM.CLASS_SELECTED)
	}

	async _openTabEditorAfterCreate(filePath: string, cmd: CreateCommand) {
		await this.performOpenFile(filePath)
		this.focusManager.setFocusedTask("editor")
		const tabView = this.tabEditorFacade.getTabEditorViewByPath(filePath)
		cmd.setOpenedTabId(tabView.getId())
	}

	//

	async performRename() {
		const focus = this.focusManager.getFocusedTask()
		if (focus !== "tree") return

		const targetInfo = this._resolveRenameTarget()
		if (!targetInfo) return

		const { treeNode, oldPath, isDirectory } = targetInfo

		const newName = await this._promptForRename(treeNode)
		if (!newName) return

		const dir = window.utils.getDirName(oldPath)
		const newPath = window.utils.getJoinedPath(dir, newName)

		if (oldPath === newPath) {
			this._restoreTreeSpan(treeNode, newPath)
			return
		}

		await this._executeRename(treeNode, isDirectory, oldPath, newPath)
	}

	private _resolveRenameTarget() {
		const treeNode = this.treeFacade.getTreeNodeByIndex(this.treeFacade.lastSelectedIndex)
		const oldPath = treeNode.dataset[DOM.DATASET_ATTR_TREE_PATH]!
		const viewModel = this.treeFacade.getTreeViewModelByPath(oldPath)
		return { treeNode, oldPath, isDirectory: viewModel.directory }
	}

	private _promptForRename(treeNode: HTMLElement): Promise<string | null> {
		return new Promise((resolve) => {
			const treeNodeSpan = treeNode.querySelector(DOM.SELECTOR_TREE_NODE_TEXT) as HTMLElement

			const treeNodeInput = document.createElement("input")
			treeNodeInput.type = "text"
			treeNodeInput.value = treeNodeSpan.textContent ?? ""
			treeNodeInput.classList.add(DOM.CLASS_TREE_NODE_INPUT)

			treeNode.classList.remove(DOM.CLASS_FOCUSED)
			treeNode.replaceChild(treeNodeInput, treeNodeSpan)
			treeNodeInput.focus()

			const lastDotIndex = treeNodeInput.value.lastIndexOf(".")
			if (lastDotIndex > 0) treeNodeInput.setSelectionRange(0, lastDotIndex)
			else treeNodeInput.select()

			let finished = false

			const cleanup = () => {
				if (finished) return
				finished = true
				treeNodeInput.removeEventListener("keydown", onKeyDown)
				treeNodeInput.removeEventListener("blur", onBlur)
			}

			const onKeyDown = (e: KeyboardEvent) => {
				if (e.key === "Enter") {
					e.stopPropagation()
					e.preventDefault()
					const val = treeNodeInput.value.trim()
					cleanup()
					resolve(val || null)
				} else if (e.key === "Escape") {
					e.stopPropagation()
					e.preventDefault()
					cleanup()
					treeNode.replaceChild(treeNodeSpan, treeNodeInput)
					resolve(null)
				}
			}

			const onBlur = () => {
				const val = treeNodeInput.value.trim()
				cleanup()
				resolve(val || null)
			}

			treeNodeInput.addEventListener("keydown", onKeyDown)
			treeNodeInput.addEventListener("blur", onBlur)
		})
	}

	private async _executeRename(treeNode: HTMLElement, isDirectory: boolean, prePath: string, newPath: string) {
		const cmd = new RenameCommand(this.treeFacade, this.tabEditorFacade, treeNode, isDirectory, prePath, newPath)

		try {
			window.rendererToMain.setWatchSkipState(true)
			await cmd.execute()
			this.undoStack.push(cmd)
			this.redoStack.length = 0
		} catch (error) {
			this._restoreTreeSpan(treeNode, prePath)
		} finally {
			await sleep(300)
			window.rendererToMain.setWatchSkipState(false)
		}
	}

	private _restoreTreeSpan(treeNode: HTMLElement, path: string) {
		const treeNodeInput = treeNode.querySelector(`.${DOM.CLASS_TREE_NODE_INPUT}`) as HTMLElement
		const restoreSpan = document.createElement("span")
		restoreSpan.classList.add(DOM.CLASS_TREE_NODE_TEXT, "ellipsis")
		restoreSpan.textContent = window.utils.getBaseName(path)
		treeNode.replaceChild(restoreSpan, treeNodeInput)
	}

	//

	async performDelete() {
		const selectedIndices = this.treeFacade.getSelectedIndices()

		const cmd = new DeleteCommand(this.treeFacade, this.tabEditorFacade, selectedIndices)

		try {
			await window.rendererToMain.setWatchSkipState(true)
			await cmd.execute()
			this.undoStack.push(cmd)
			this.redoStack.length = 0
		} catch {
			// intentionally empty
		} finally {
			await sleep(300)
			window.rendererToMain.setWatchSkipState(false)
		}
	}

	//

	performCutEditor() {
		const view = this.tabEditorFacade.getActiveTabEditorView()
		view.markAsModified()
	}

	async performCutEditorManual() {
		const sel = window.getSelection()
		const selectedText = sel?.toString()
		if (!sel || !selectedText) return

		await window.rendererToMain.cutEditor(selectedText)
		sel.deleteFromDocument()

		this.performCutEditor()
	}

	performCutTree() {
		this.treeFacade.clearClipboardPaths()
		this.treeFacade.clipboardMode = "cut"
		const selectedIndices = this.treeFacade.getSelectedIndices()

		for (const idx of selectedIndices) {
			this.treeFacade.getTreeWrapperByIndex(idx).classList.add(DOM.CLASS_CUT)
			this.treeFacade.addClipboardPaths(this.treeFacade.getTreeViewModelByIndex(idx).path)
			const viewModel = this.treeFacade.getTreeViewModelByIndex(idx)

			if (viewModel.directory) {
				for (let i = idx + 1; i < this.treeFacade.flattenTree.length; i++) {
					const isChildViewModel = this.treeFacade.getTreeViewModelByIndex(i)

					if (viewModel.indent < isChildViewModel.indent) {
						// note: We skip adding CLASS_CUT to children, as parent visually affects them
						// this.treeFacade.getTreeWrapperByIndex(i).classList.add(CLASS_CUT)
						this.treeFacade.addClipboardPaths(this.treeFacade.getTreeViewModelByIndex(idx).path)
						continue
					}

					break
				}
			}
		}
	}

	async performCopyEditor() {
		const sel = window.getSelection()
		const selectedText = window.getSelection()?.toString()
		if (!sel || !selectedText) return

		await window.rendererToMain.copyEditor(selectedText)
	}

	performCopyTree() {
		this.treeFacade.clearClipboardPaths()
		this.treeFacade.clipboardMode = "copy"
		const selectedIndices = this.treeFacade.getSelectedIndices()

		for (const idx of selectedIndices) {
			this.treeFacade.addClipboardPaths(this.treeFacade.getTreeViewModelByIndex(idx).path)
			const viewModel = this.treeFacade.getTreeViewModelByIndex(idx)

			if (viewModel.directory) {
				for (let i = idx + 1; i < this.treeFacade.flattenTree.length; i++) {
					const isChildViewModel = this.treeFacade.getTreeViewModelByIndex(i)

					if (viewModel.indent < isChildViewModel.indent) {
						this.treeFacade.addClipboardPaths(this.treeFacade.getTreeViewModelByIndex(idx).path)
						continue
					}

					break
				}
			}
		}
	}

	performPasteEditor() {
		const view = this.tabEditorFacade.getActiveTabEditorView()
		view.markAsModified()
	}

	async performPasteEditorManual() {
		const editable = document.querySelector('#editor-container [contenteditable="true"]') as HTMLElement
		if (!editable) return
		editable.focus()

		const sel = window.getSelection()
		if (!sel || !sel.rangeCount) return
		sel.deleteFromDocument()

		const text = await window.rendererToMain.pasteEditor()
		const textNode = document.createTextNode(text)
		const range = sel.getRangeAt(0)
		range.insertNode(textNode)
		range.setStartAfter(textNode)
		// Defensive code to ensure cursor positioning
		range.collapse(true)
		sel.removeAllRanges()
		sel.addRange(range)

		this.performPasteEditor()
	}

	async performPasteTreeWithContextmenu() {
		const targetIndex = this.treeFacade.contextTreeIndex
		await this._performPasteTree(targetIndex)
	}

	async performPasteTreeWithShortcut() {
		const targetIndex = this.treeFacade.lastSelectedIndex
		await this._performPasteTree(targetIndex)
	}

	async performPasteTreeWithDrag() {
		const targetIndex = this.treeFacade.selectedDragIndex
		await this._performPasteTree(targetIndex)
	}

	private async _performPasteTree(targetIndex: number) {
		if (targetIndex === -1) return

		let targetViewModel = this.treeFacade.getTreeViewModelByIndex(targetIndex)
		
		const clipboardPaths = this.treeFacade.getClipboardPaths() ?? []
		const isPastingOnSelf = clipboardPaths.includes(targetViewModel.path)

		if (!targetViewModel.directory || isPastingOnSelf) {
			targetIndex = this.treeFacade.findParentDirectoryIndex(targetIndex)
			targetViewModel = this.treeFacade.getTreeViewModelByIndex(targetIndex)
		}

		const selectedViewModels = []
		for (const path of clipboardPaths) {
			selectedViewModels.push(this.treeFacade.getTreeViewModelByPath(path))
		}

		const cmd = new PasteCommand(
			this.treeFacade,
			this.tabEditorFacade,
			targetViewModel,
			selectedViewModels,
			this.treeFacade.clipboardMode
		)

		try {
			window.rendererToMain.setWatchSkipState(true)
			await cmd.execute()
			this.undoStack.push(cmd)
			this.redoStack.length = 0
		} catch {
			// intentionally empty
		} finally {
			await sleep(300)
			window.rendererToMain.setWatchSkipState(false)
		}
	}

	//

	toggleFindReplaceBox(showReplace: boolean) {
		if (this.tabEditorFacade.activeTabId === -1) return

		this.tabEditorFacade.findAndReplaceContainer.style.display = "flex"
		this.tabEditorFacade.replaceBox.style.display = showReplace ? "flex" : "none"
		this.tabEditorFacade.findReplaceOpen = true

		if (showReplace) this.tabEditorFacade.replaceInput.focus()
		else this.tabEditorFacade.findInput.focus()

		this.performFind(this.tabEditorFacade.findDirection)
	}

	performSearchQueryChanged(query: string) {
		this.tabEditorFacade.searchQuery = query
		this.performFind(this.tabEditorFacade.findDirection)
	}

	performReplaceQueryChanged(query: string) {
		this.tabEditorFacade.replaceQuery = query
	}

	performFind(direction: "up" | "down") {
		this.tabEditorFacade.findNextMatch(direction)
	}

	performReplace() {
		const replaceInput = this.tabEditorFacade.replaceQuery
		const view = this.tabEditorFacade.getActiveTabEditorView()

		const replaced = view.replaceCurrentMatch(replaceInput)
		if (!replaced) return

		this.tabEditorFacade.findNextMatch()
	}

	performReplaceAll() {
		const findInput = this.tabEditorFacade.searchQuery
		const replaceInput = this.tabEditorFacade.replaceQuery

		const view = this.tabEditorFacade.getActiveTabEditorView()
		view.replaceAllMatches(findInput, replaceInput)
	}

	performCloseFindReplaceBox() {
		if (!this.tabEditorFacade.findReplaceOpen) return

		this.tabEditorFacade.findAndReplaceContainer.style.display = "none"

		const activeView = this.tabEditorFacade.getActiveTabEditorView()
		if (activeView) activeView.clearSearch()

		this.tabEditorFacade.findReplaceOpen = false
	}

	//

	performFindOrReplaceByActiveElement() {
		const activateElement = document.activeElement

		if (activateElement === this.tabEditorFacade.findInput) {
			this.performFind(this.tabEditorFacade.findDirection)
		} else if (activateElement === this.tabEditorFacade.replaceInput) {
			this.performReplace()
		}
	}

	//

	performApplySettings(viewModel: SettingsViewModel) {
		const editor = viewModel.settingEditorViewModel
		const theme = viewModel.settingThemeViewModel.theme

		editor.width && this.tabEditorFacade.changeEditorWidth(editor.width)
		editor.fontSize && this.tabEditorFacade.changeFontSize(editor.fontSize)
		editor.fontFamily && this.tabEditorFacade.changeFontFamily(editor.fontFamily)

		if (theme) {
			const html = document.documentElement
			html.classList.remove("light", "solarized", "slate")
			html.classList.add(theme)
		}

		this.settingsFacade.applyChangeSet()
	}

	async performApplyAndSaveSettings(viewModel: SettingsViewModel) {
		this.performApplySettings(viewModel)
		const settingsDto = this.settingsFacade.toSettingsDto(this.settingsFacade.getDraftSettings())
		await window.rendererToMain.syncSettingsSessionFromRenderer(settingsDto)
	}
}
