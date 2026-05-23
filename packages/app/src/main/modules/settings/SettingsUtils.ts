import type IFileManager from "../contracts/IFileManager"
import type ISettingsUtils from "../contracts/ISettingsUtils"
import type { SettingsDto, SettingEditorDto, SettingThemeDto } from "@shared/dto/SettingsDto"
import type {
	SettingsSessionModel,
	SettingEditorSessionModel,
	SettingThemeSessionModel,
} from "@main/models/SettingsSessionModel"
import { inject, injectable } from "inversify"
import DI_KEYS from "../../constants/di_keys"

@injectable()
export default class SettingsUtils implements ISettingsUtils {
	constructor(@inject(DI_KEYS.FileManager) private readonly fileManager: IFileManager) {}

	toSettingsDto(session: SettingsSessionModel): SettingsDto {
		return {
			settingEditorDto: session.settingEditorSessionModel as SettingEditorDto,
			settingThemeDto: session.settingThemeSessionModel as SettingThemeDto,
		}
	}

	toSettingsSessionModel(dto: SettingsDto): SettingsSessionModel {
		return {
			settingEditorSessionModel: dto.settingEditorDto as SettingEditorSessionModel,
			settingThemeSessionModel: dto.settingThemeDto as SettingThemeSessionModel,
		}
	}
}
