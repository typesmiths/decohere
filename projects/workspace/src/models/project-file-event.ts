import type { FileEx } from "@decohere/core/io";
import type { WatchEventName } from "@decohere/devkit/io";
import type { Project } from "./project.model.js";

export type ProjectFileEvent = {
	eventName: WatchEventName;
	project: Project;
	configuration: string;
	file: FileEx;
};
