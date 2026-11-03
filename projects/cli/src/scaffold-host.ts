import { containerArgvFromHost, runInBuilder } from "@decohere/create";
import { injectable } from "@decohere/crucible/decorators";
import type { ActionResponse } from "@decohere/devkit/cli";
import {
	AddApiAction,
	type AddApiOptions,
	AddModule,
	Auth0ConfigureAction,
	type Auth0ConfigureOptions,
	Auth0LoginAction,
	Auth0Module,
	CreateModule,
	WebapiAction,
	type WebapiOptions,
} from "@decohere/scaffold";

@injectable()
class HostWebapiAction extends WebapiAction {
	public override async run(options: WebapiOptions): Promise<ActionResponse> {
		if (process.env.DECOHERE_BUILDER !== "1") {
			runInBuilder(containerArgvFromHost(process.argv));
		}
		return super.run(options);
	}
}

@injectable()
class HostAddApiAction extends AddApiAction {
	public override async run(options: AddApiOptions): Promise<ActionResponse> {
		if (process.env.DECOHERE_BUILDER !== "1") {
			runInBuilder(containerArgvFromHost(process.argv));
		}
		return super.run(options);
	}
}

/** Host `decohere create` — Docker-delegates unless already inside the builder image. */
export class HostCreateModule extends CreateModule {
	public override readonly actions = { webapi: HostWebapiAction };
}

/** Host `decohere add` — Docker-delegates unless already inside the builder image. */
export class HostAddModule extends AddModule {
	public override readonly actions = { api: HostAddApiAction };
}

@injectable()
class HostAuth0LoginAction extends Auth0LoginAction {
	public override async run(): Promise<ActionResponse> {
		if (process.env.DECOHERE_BUILDER !== "1") {
			runInBuilder(containerArgvFromHost(process.argv));
		}
		return super.run();
	}
}

@injectable()
class HostAuth0ConfigureAction extends Auth0ConfigureAction {
	public override async run(options: Auth0ConfigureOptions): Promise<ActionResponse> {
		if (process.env.DECOHERE_BUILDER !== "1") {
			runInBuilder(containerArgvFromHost(process.argv));
		}
		return super.run(options);
	}
}

/** Host `decohere auth0` — Docker-delegates unless already inside the builder image. */
export class HostAuth0Module extends Auth0Module {
	public override readonly actions = {
		login: HostAuth0LoginAction,
		configure: HostAuth0ConfigureAction,
	};
}
