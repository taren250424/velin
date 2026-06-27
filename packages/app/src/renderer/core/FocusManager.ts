import { injectable } from "inversify"
import { type Zone, type Task, UI_ZONES_VALUES } from "./types"

@injectable()
export class FocusManager {
	private focusedZone: Zone = "none"
	private focusedTask: Task = "none"

	setFocusedZone(zone: Zone) {
		this.focusedZone = zone
	}

	getFocusedZone() {
		return this.focusedZone
	}

	setFocusedTask(task: Task) {
		this.focusedTask = task
	}

	getFocusedTask() {
		const el = document.activeElement
		if (!el) return this.focusedTask

		const activeItem = UI_ZONES_VALUES.find((item) => el.closest(item.dom))
		if (activeItem && activeItem.task !== "") return activeItem.task as Task

		return this.focusedTask
	}
}
