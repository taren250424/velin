export default interface IFileWatcher {
	watch(dirPath: string): Promise<void>
	setSkipState(state: boolean): void
	close(): Promise<void>
}
