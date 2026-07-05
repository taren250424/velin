import { DI } from "@renderer/constants"
import type {
	SettingsViewModel,
	SettingEditorViewModel,
	SettingThemeViewModel,
} from "@renderer/viewmodels/SettingsViewModel"
import { inject, injectable } from "inversify"
import type { SettingsElements } from "./SettingsElements"
import type { AeroOption } from "@taren250424/aero"

@injectable()
export class SettingsRenderer {
	constructor(@inject(DI.SettingsElements) readonly elements: SettingsElements) {}

	//

	openSettings() {
		this.elements.overlay.style.display = "flex"
	}

	closeSettings() {
		this.elements.overlay.style.display = "none"
	}

	//

	render(viewModel: SettingsViewModel) {
		this._renderSettingEditor(viewModel.settingEditorViewModel)
		this._renderSettingTheme(viewModel.settingThemeViewModel)
	}

	private _renderSettingEditor(editorViewModel: SettingEditorViewModel) {
		this.elements.editorWidthInput.value = editorViewModel.width.toString()
		this.elements.fontSizeInput.value = editorViewModel.fontSize.toString()
		this.elements.fontFamilyInput.value = editorViewModel.fontFamily.toString()
		this.elements.autoSaveSelect.optionIndex = Array.from(this.elements.autoSaveOptions).findIndex(
			(el) => el.value === editorViewModel.autoSave
		)
	}

	private _renderSettingTheme(themeViewModel: SettingThemeViewModel) {
		this.elements.themeSelect.optionIndex = Array.from(this.elements.themeOptions).findIndex(
			(el) => el.value === themeViewModel.theme
		)
	}

	//

	onChangeEditorWidth(callback: (width: number) => void) {
		this.elements.editorWidthInput.addEventListener("change", () => {
			callback(Number(this.elements.editorWidthInput.value))
		})
	}

	onChangeFontSize(callback: (size: number) => void) {
		this.elements.fontSizeInput.addEventListener("change", () => {
			callback(Number(this.elements.fontSizeInput.value))
		})
	}

	onChangeFontFamily(callback: (family: string) => void) {
		this.elements.fontFamilyInput.addEventListener("change", () => {
			callback(this.elements.fontFamilyInput.value)
		})
	}

	onChangeAutoSave(callback: (autoSave: string) => void) {
		this.elements.autoSaveSelect.addEventListener("aero-select-changed", (e) => {
			const option = e.detail.option as AeroOption
			callback(option.value)
		})
	}

	onChangeTheme(callback: (theme: string) => void) {
		this.elements.themeSelect.addEventListener("aero-select-changed", (e) => {
			const option = e.detail.option as AeroOption
			callback(option.value)
		})
	}
}
