import path from "node:path";
import { invalidateMemoize, memoize } from "@decohere/core/caching";
import { io } from "@decohere/core/io";
import { PACKAGE_JSON } from "../const.js";
import { PackageJson } from "./package-json.model.js";

export abstract class HasPackageJson {
	protected abstract packageJson?: PackageJson;
	protected abstract get packageJsonDirectory(): string;

	@memoize()
	public async getPackageJson() {
		return new PackageJson(
			await io.readJsonFile(path.join(this.packageJsonDirectory, PACKAGE_JSON)),
		);
	}

	public get packageJsonPath() {
		return path.join(this.packageJsonDirectory, PACKAGE_JSON);
	}

	public async getVersion() {
		return (await this.getPackageJson()).version;
	}

	public async persistPackageJson(packageJson: PackageJson) {
		await io.writeFile(this.packageJsonPath, packageJson.toJSON());
		invalidateMemoize.evict(this, HasPackageJson.prototype.getPackageJson);
	}
}
