import {
	containerArgvFromHost,
	hasDecohereTools,
	OPEN_DEV_CONTAINER_MESSAGE,
	launch,
} from "@decohere/create";
import { injectable } from "@decohere/crucible/decorators";
import { ActionResponse } from "@decohere/devkit/cli";
import {
	AddApiAction,
	type AddApiOptions,
	AddAuth0Action,
	type AddAuth0Options,
	AddModule,
	Auth0ConfigureAction,
	type Auth0ConfigureOptions,
	Auth0LoginAction,
	Auth0TokenAction,
	type Auth0TokenOptions,
	Auth0Module,
	CreateModule,
	WebapiAction,
	type WebapiOptions,
} from "@decohere/scaffold";

/** Commands on an existing project only run where the Dev Container's tools are. */
function needsDevContainer(name: string): ActionResponse {
	return ActionResponse.Error(name, OPEN_DEV_CONTAINER_MESSAGE);
}

@injectable()
class HostWebapiAction extends WebapiAction {
	public override async run(options: WebapiOptions): Promise<ActionResponse> {
		// One path for every way of creating a project, so the admin password is handled once.
		await launch(containerArgvFromHost(process.argv));
		return super.run(options);
	}
}

@injectable()
class HostAddApiAction extends AddApiAction {
	public override async run(options: AddApiOptions): Promise<ActionResponse> {
		if (!hasDecohereTools()) return needsDevContainer("api");
		return super.run(options);
	}
}

/** `decohere create` — uses the scaffolder image unless this container has the tools. */
export class HostCreateModule extends CreateModule {
	public override readonly actions = { webapi: HostWebapiAction };
}

@injectable()
class HostAddAuth0Action extends AddAuth0Action {
	public override async run(options: AddAuth0Options): Promise<ActionResponse> {
		if (!hasDecohereTools()) return needsDevContainer("auth0");
		return super.run(options);
	}
}

/** `decohere add` — runs only where the Dev Container's tools are. */
export class HostAddModule extends AddModule {
	public override readonly actions = { api: HostAddApiAction, auth0: HostAddAuth0Action };
}

@injectable()
class HostAuth0LoginAction extends Auth0LoginAction {
	public override async run(): Promise<ActionResponse> {
		if (!hasDecohereTools()) return needsDevContainer("login");
		return super.run();
	}
}

@injectable()
class HostAuth0ConfigureAction extends Auth0ConfigureAction {
	public override async run(options: Auth0ConfigureOptions): Promise<ActionResponse> {
		if (!hasDecohereTools()) return needsDevContainer("configure");
		return super.run(options);
	}
}

@injectable()
class HostAuth0TokenAction extends Auth0TokenAction {
	public override async run(options: Auth0TokenOptions): Promise<ActionResponse> {
		if (!hasDecohereTools()) return needsDevContainer("token");
		return super.run(options);
	}
}

/** `decohere auth0` — runs only where the Dev Container's tools are. */
export class HostAuth0Module extends Auth0Module {
	public override readonly actions = {
		login: HostAuth0LoginAction,
		configure: HostAuth0ConfigureAction,
		token: HostAuth0TokenAction,
	};
}
