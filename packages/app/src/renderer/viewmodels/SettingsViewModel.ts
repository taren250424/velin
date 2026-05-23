export interface SettingsViewModel {
	settingEditorViewModel: SettingEditorViewModel
	settingThemeViewModel: SettingThemeViewModel
}

export interface SettingEditorViewModel {
	width: number
	fontSize: number
	fontFamily: string
}

export interface SettingThemeViewModel {
	theme: string
}
