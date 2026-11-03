import { fileURLToPath, pathToFileURL } from "node:url";

export const fileUrlToPath = (url: string) => {
	try {
		return fileURLToPath(url);
	} catch {
		return url;
	}
};

export const pathToFileUrl = (path: string) => {
	try {
		return pathToFileURL(path).toString();
	} catch {
		return path;
	}
};
