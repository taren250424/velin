import { inject, injectable } from "inversify"
import { DI } from "../constants"
import { FocusManager } from "./index"

@injectable()
export class ShortcutRegistry {
	// Navigation keys may fire repeatedly while held; every other shortcut
	// ignores key auto-repeat so a held key (e.g. Delete) cannot burst commands.
	private static readonly REPEATABLE_KEYS = new Set(["ARROWUP", "ARROWDOWN", "Shift+ARROWUP", "Shift+ARROWDOWN"])

	private shortcutMap = new Map<string, (e: KeyboardEvent) => any>()

	constructor(@inject(DI.FocusManager) private readonly focusManager: FocusManager) {}

	register(key: string, handler: (e: KeyboardEvent) => any) {
		this.shortcutMap.set(key, handler)
	}

	handleKeyEvent(e: KeyboardEvent) {
		const key = this.getKeyString(e)
		// console.log(key)
		const handler = this.shortcutMap.get(key)
		if (handler) {
			// Prevent the default browser behavior only when the focus is NOT inside the editor.
			// This avoids interfering with native editor shortcuts (like copy/paste),
			// while ensuring custom shortcuts work properly in other UI areas (e.g., sidebar, tree view).
			const task = this.focusManager.getFocusedTask()
			if (task !== "editor") {
				e.preventDefault()
			}

			if (e.repeat && !ShortcutRegistry.REPEATABLE_KEYS.has(key)) return

			handler(e)
		}
	}

	getKeyString(e: KeyboardEvent): string {
		const parts = []
		if (e.ctrlKey) parts.push("Ctrl")
		if (e.shiftKey) parts.push("Shift")
		if (e.altKey) parts.push("Alt")

		let key = e.key

		if (key === "=") key = "+"
		if (key === "Escape") key = "Esc"
		if (key === " ") key = "Space"

		parts.push(key.toUpperCase())
		return parts.join("+")
	}
}
