import { spawnSync } from "node:child_process";

function parseArgs(argv) {
	const args = argv.slice(2);
	const flags = {
		repo: process.env.GITHUB_REPOSITORY ?? "typesmiths/decohere",
		project: "Ark",
		sprintField: "Sprint",
		estimateField: "Estimate (days)",
		iteration: undefined,
		estimate: undefined,
		apply: false,
	};

	let issueNumber;
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (!arg.startsWith("--") && issueNumber == null) {
			issueNumber = Number(arg);
			continue;
		}
		if (arg === "--apply") {
			flags.apply = true;
			continue;
		}
		const next = args[i + 1];
		if (next == null) throw new Error(`Missing value for ${arg}`);
		switch (arg) {
			case "--repo":
				flags.repo = next;
				i += 1;
				break;
			case "--project":
				flags.project = next;
				i += 1;
				break;
			case "--sprint-field":
				flags.sprintField = next;
				i += 1;
				break;
			case "--estimate-field":
				flags.estimateField = next;
				i += 1;
				break;
			case "--iteration":
				flags.iteration = next;
				i += 1;
				break;
			case "--estimate": {
				const value = Number.parseFloat(next);
				if (!Number.isFinite(value) || value < 0)
					throw new Error(`Invalid --estimate value: ${next}`);
				flags.estimate = value;
				i += 1;
				break;
			}
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
		throw new Error(
			"Usage: node ensure-metadata.mjs <issue-number> [--repo owner/name] [--project Ark] [--apply]",
		);
	}

	return { issueNumber, ...flags };
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

function getIssue(repo, issueNumber) {
	const { owner, name } = splitRepo(repo);
	const query = `query($owner:String!, $name:String!, $number:Int!) { repository(owner:$owner, name:$name) { issue(number:$number) { id number title state projectItems(first:50) { nodes { id project { id title } fieldValues(first:50) { nodes { ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } } ... on ProjectV2ItemFieldIterationValue { title iterationId field { ... on ProjectV2FieldCommon { name } } } ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ... on ProjectV2FieldCommon { name } } } } } } } } } }`;
	const response = runGhJson([
		"api",
		"graphql",
		"-f",
		`query=${query}`,
		"-f",
		`owner=${owner}`,
		"-f",
		`name=${name}`,
		"-F",
		`number=${issueNumber}`,
	]);
	const issue = response?.data?.repository?.issue;
	if (!issue) throw new Error(`Issue #${issueNumber} not found in ${repo}`);
	return issue;
}

function getProjectByTitle(org, projectTitle) {
	const query = `query($org:String!) { organization(login:$org) { projectsV2(first:50) { nodes { id title fields(first:50) { nodes { ... on ProjectV2Field { id name } ... on ProjectV2IterationField { id name configuration { iterations { id title } } } ... on ProjectV2SingleSelectField { id name options { id name } } } } } } } }`;
	const response = runGhJson(["api", "graphql", "-f", `query=${query}`, "-f", `org=${org}`]);
	const projects = response?.data?.organization?.projectsV2?.nodes ?? [];
	const project = projects.find((p) => p.title === projectTitle);
	if (!project) throw new Error(`Project "${projectTitle}" not found for org "${org}"`);
	return project;
}

function addIssueToProject(projectId, issueId) {
	const mutation = `mutation($project:ID!, $content:ID!) { addProjectV2ItemById(input:{projectId:$project, contentId:$content}) { item { id } } }`;
	runGh([
		"api",
		"graphql",
		"-f",
		`query=${mutation}`,
		"-f",
		`project=${projectId}`,
		"-f",
		`content=${issueId}`,
	]);
}

function getProjectItem(issue, projectTitle) {
	return issue.projectItems?.nodes?.find((item) => item.project?.title === projectTitle);
}

function getFieldValue(projectItem, fieldName) {
	return projectItem?.fieldValues?.nodes?.find((node) => node?.field?.name === fieldName);
}

function computeMissing(issue, projectTitle, sprintFieldName, estimateFieldName) {
	const projectItem = getProjectItem(issue, projectTitle);
	const sprintValue = projectItem
		? getFieldValue(projectItem, sprintFieldName)?.title
		: undefined;
	const estimateValue = projectItem
		? getFieldValue(projectItem, estimateFieldName)?.number
		: undefined;
	return {
		project: projectItem == null,
		sprint: sprintValue == null,
		estimate: estimateValue == null,
		sprintValue,
		estimateValue,
	};
}

function getRequiredField(project, fieldName) {
	const field = (project?.fields?.nodes ?? []).find((node) => node?.name === fieldName);
	if (!field?.id)
		throw new Error(`Field "${fieldName}" not found on project "${project.title}"`);
	return field;
}

function setProjectItemNumberField(projectId, itemId, fieldId, value) {
	const mutation = `mutation($project:ID!, $item:ID!, $field:ID!, $value:Float!) { updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{number:$value}}) { projectV2Item { id } } }`;
	runGh([
		"api",
		"graphql",
		"-f",
		`query=${mutation}`,
		"-f",
		`project=${projectId}`,
		"-f",
		`item=${itemId}`,
		"-f",
		`field=${fieldId}`,
		"-F",
		`value=${value}`,
	]);
}

function setProjectItemIterationField(projectId, itemId, fieldId, iterationId) {
	const mutation = `mutation($project:ID!, $item:ID!, $field:ID!, $iterationId:String!) { updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{iterationId:$iterationId}}) { projectV2Item { id } } }`;
	runGh([
		"api",
		"graphql",
		"-f",
		`query=${mutation}`,
		"-f",
		`project=${projectId}`,
		"-f",
		`item=${itemId}`,
		"-f",
		`field=${fieldId}`,
		"-f",
		`iterationId=${iterationId}`,
	]);
}

function setProjectItemSingleSelectField(projectId, itemId, fieldId, optionId) {
	const mutation = `mutation($project:ID!, $item:ID!, $field:ID!, $optionId:String!) { updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$optionId}}) { projectV2Item { id } } }`;
	runGh([
		"api",
		"graphql",
		"-f",
		`query=${mutation}`,
		"-f",
		`project=${projectId}`,
		"-f",
		`item=${itemId}`,
		"-f",
		`field=${fieldId}`,
		"-f",
		`optionId=${optionId}`,
	]);
}

function applySprintValue(project, projectId, itemId, sprintFieldName, iterationName) {
	const sprintField = getRequiredField(project, sprintFieldName);
	if (sprintField?.configuration?.iterations) {
		const iteration = sprintField.configuration.iterations.find(
			(v) => v.title === iterationName,
		);
		if (!iteration)
			throw new Error(`Iteration "${iterationName}" not found in field "${sprintFieldName}"`);
		setProjectItemIterationField(projectId, itemId, sprintField.id, iteration.id);
		return;
	}
	if (sprintField?.options) {
		const option = sprintField.options.find((v) => v.name === iterationName);
		if (!option)
			throw new Error(`Option "${iterationName}" not found in field "${sprintFieldName}"`);
		setProjectItemSingleSelectField(projectId, itemId, sprintField.id, option.id);
		return;
	}
	throw new Error(`Field "${sprintFieldName}" is not an iteration/single-select field`);
}

function printSummary(issue, missing, projectTitle, sprintFieldName, estimateFieldName) {
	console.log(`#${issue.number} ${issue.title}`);
	console.log(`- state: ${issue.state}`);
	console.log(`- sprint (${sprintFieldName}): ${missing.sprintValue ?? "none (backlog)"}`);
	console.log(`- estimate (${estimateFieldName}): ${missing.estimateValue ?? "none"}`);
	console.log(
		`- project assignment (${projectTitle}): ${missing.project ? "missing" : "present"}`,
	);
}

const args = parseArgs(process.argv);
const { owner } = splitRepo(args.repo);
const issue = getIssue(args.repo, args.issueNumber);
let missing = computeMissing(issue, args.project, args.sprintField, args.estimateField);

let project;
if (args.apply) {
	if (missing.project) {
		project = getProjectByTitle(owner, args.project);
		addIssueToProject(project.id, issue.id);
	}

	let refreshed = getIssue(args.repo, args.issueNumber);
	let refreshedItem = getProjectItem(refreshed, args.project);
	if (!project) project = getProjectByTitle(owner, args.project);
	if (!refreshedItem)
		throw new Error(
			`Issue #${args.issueNumber} is still not assigned to project "${args.project}"`,
		);

	if (missing.sprint && args.iteration) {
		applySprintValue(project, project.id, refreshedItem.id, args.sprintField, args.iteration);
		refreshed = getIssue(args.repo, args.issueNumber);
		refreshedItem = getProjectItem(refreshed, args.project);
	}

	if (missing.estimate) {
		if (args.estimate == null)
			throw new Error("Issue is missing estimate. Re-run with --estimate <days> --apply");
		const estimateField = getRequiredField(project, args.estimateField);
		setProjectItemNumberField(project.id, refreshedItem.id, estimateField.id, args.estimate);
	}

	const finalIssue = getIssue(args.repo, args.issueNumber);
	missing = computeMissing(finalIssue, args.project, args.sprintField, args.estimateField);
	printSummary(finalIssue, missing, args.project, args.sprintField, args.estimateField);
} else {
	printSummary(issue, missing, args.project, args.sprintField, args.estimateField);
}

if (missing.project || missing.estimate) {
	console.error(
		"Issue metadata requirements not met (project + estimate; sprint optional/backlog).",
	);
	process.exit(2);
}

console.log("Issue metadata requirements satisfied.");
