import { fs, vol } from "memfs";

export function resetMemfs(): void {
	vol.reset();
}

export function seedMemfs(files: Record<string, string>): void {
	vol.fromJSON(files);
}

export function createTestFile(filePath: string, content: string | Buffer): void {
	fs.mkdirSync(filePath.substring(0, filePath.lastIndexOf("/")), { recursive: true });
	fs.writeFileSync(filePath, content);
}

export async function readFile(filePath: string): Promise<string> {
	const response = (await fs.promises.readFile(filePath, "utf8")) as string;
	return response;
}

export function fileExists(filePath: string): boolean {
	try {
		vol.statSync(filePath);
		return true;
	} catch {
		return false;
	}
}
