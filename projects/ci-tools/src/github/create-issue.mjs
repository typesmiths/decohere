import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function parseArgs(argv) {
	const args = argv.slice(2);
	const flags = {
		repo: process.env.GITHUB_REPOSITORY ?? "typesmiths/decohere",
		type: "Task",
		typeId: undefined,
		title: undefined,
		bodyFile: undefined,
		allowDuplicate: false,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--allow-duplicate") {
			flags.allowDuplicate = true;
			continue;
		}
		const next = args[index + 1];
		if (next == null) throw new Error(`Missing value for ${arg}`);
		switch (arg) {
			case "--repo":
				flags.repo = next;
				index += 1;
				break;
			case "--type":
				flags.type = next;
				index += 1;
				break;
			case "--type-id":
				flags.typeId = next;
				index += 1;
				break;
			case "--title":
				flags.title = next;
				index += 1;
				break;
			case "--body-file":
				flags.bodyFile = next;
				index += 1;
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!flags.title) throw new Error("Missing required argument: --title");
	if (!flags.bodyFile) throw new Error("Missing required argument: --body-file");
	if (!existsSync(flags.bodyFile)) throw new Error(`Body file not found: ${flags.bodyFile}`);
	return flags;
}

function runGh(args) {
	const result = spawnSync("gh", args, { encoding: "utf8", env: process.env });
	if (result.status !== 0)
		throw new Error(result.stderr || result.stdout || `gh command failed: ${args.join(" ")}`);
	return result.stdout;
}

function runGhJson(args) {
	return JSON.parse(runGh(args));
}

function splitRepo(repo) {
	const [owner, name] = repo.split("/");
	if (!owner || !name) throw new Error(`Invalid repo format: ${repo}. Expected owner/name`);
	return { owner, name };
}

function findExistingIssue(repo, title) {
	const output = runGhJson([
		"issue",
		"list",
		"--repo",
		repo,
		"--state",
		"all",
		"--limit",
		"200",
		"--search",
		`${title} in:title`,
		"--json",
		"number,title,state,url",
	]);
	return output.find((issue) => issue.title === title);
}

function getRepositoryMetadata(repo, typeName) {
	const { owner, name } = splitRepo(repo);
	const query = `query($owner:String!, $name:String!) { repository(owner:$owner, name:$name) { id issueTypes(first:20) { nodes { id name } } } }`;
	const response = runGhJson([
		"api",
		"graphql",
		"-f",
		`query=${query}`,
		"-f",
		`owner=${owner}`,
		"-f",
		`name=${name}`,
	]);
	const repository = response?.data?.repository;
	if (!repository?.id) throw new Error(`Repository not found: ${repo}`);
	const typeMatch = repository.issueTypes?.nodes?.find((node) => node.name === typeName);
	if (!typeMatch) {
		const available = (repository.issueTypes?.nodes ?? []).map((node) => node.name).join(", ");
		throw new Error(`Issue type "${typeName}" not found. Available: ${available}`);
	}
	return { repositoryId: repository.id, issueTypeId: typeMatch.id };
}

function createIssue(repositoryId, issueTypeId, title, body) {
	const mutation = `mutation($repositoryId:ID!, $issueTypeId:ID!, $title:String!, $body:String!) { createIssue(input:{repositoryId:$repositoryId, issueTypeId:$issueTypeId, title:$title, body:$body}) { issue { number title url state } } }`;
	const response = runGhJson([
		"api",
		"graphql",
		"-f",
		`query=${mutation}`,
		"-f",
		`repositoryId=${repositoryId}`,
		"-f",
		`issueTypeId=${issueTypeId}`,
		"-f",
		`title=${title}`,
		"-f",
		`body=${body}`,
	]);
	return response?.data?.createIssue?.issue;
}

const args = parseArgs(process.argv);
const body = readFileSync(args.bodyFile, "utf8");

if (!args.allowDuplicate) {
	const existing = findExistingIssue(args.repo, args.title);
	if (existing) {
		console.log(
			`Existing issue found (duplicate prevented): #${existing.number} ${existing.url}`,
		);
		process.exit(0);
	}
}

let metadata;
if (args.typeId) {
	const { owner, name } = splitRepo(args.repo);
	const query = `query($owner:String!, $name:String!) { repository(owner:$owner, name:$name) { id } }`;
	const response = runGhJson([
		"api",
		"graphql",
		"-f",
		`query=${query}`,
		"-f",
		`owner=${owner}`,
		"-f",
		`name=${name}`,
	]);
	const repositoryId = response?.data?.repository?.id;
	if (!repositoryId) throw new Error(`Repository not found: ${args.repo}`);
	metadata = { repositoryId, issueTypeId: args.typeId };
} else {
	metadata = getRepositoryMetadata(args.repo, args.type);
}

const createdIssue = createIssue(
	metadata.repositoryId,
	metadata.issueTypeId,
	args.title,
	body,
);
if (!createdIssue) throw new Error("Issue creation failed: API response missing issue data");
console.log(`Created issue: #${createdIssue.number} ${createdIssue.url}`);
