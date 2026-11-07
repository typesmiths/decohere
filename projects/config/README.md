# Config

Application configuration for Decohere: data sources that feed the configuration service, starting with YAML files read from the environment.

## YAML files

`YamlDataSource` reads two files from `CONFIG_DIR` (default `config`):

1. `config.yaml`: production, and the base for every environment.
2. `config.<NODE_ENV>.yaml`, if it exists, such as `config.dev.yaml`. An unset `NODE_ENV` means `production`, so a missing variable never loads development settings.

### How the files merge

The environment file only states what it changes:

- **Objects** merge key by key.
- **Lists of named entries** merge by `name`. Every entry is a mapping with a string `name`, as in `database.dataSources`. An entry with a name the base already has merges into that entry, and a new name is added at the end. The base keeps its order. A file that repeats a name in such a list is rejected, because the merge couldn't tell the entries apart.
- **Any other list**, and a scalar, replaces the earlier value. An empty list (`[]`) clears it.

```yaml
# config.yaml
database:
  dataSources:
    - name: api
      host: ${API_DB_HOST}
      password: ${API_DB_PASSWORD}
      synchronize: false

# config.dev.yaml: only what development changes
database:
  dataSources:
    - name: api
      synchronize: true
```

### Placeholders

`${NAME}` reads an environment variable, and `${NAME:default}` gives it a default. Placeholders are resolved **after** the merge. That way an environment file can replace a production `${VAR}` without the variable being set. Placeholders still unset after the merge fail together, and the error names every variable and where it was used. A variable set to the text `null` means no value.

Secrets come only from the process environment ([ADR 0002](../../docs/adr/0002-secrets-from-the-environment.md)). Nothing here reads a `.env` file; a CLI loads one only with an explicit `--env-file`.

## Layers

`config(...)` lists where configuration comes from, in order. A later source overrides an earlier one, key by key, on top of the defaults in the section's class:

```ts
builder.use(config(YamlDataSource, EnvDataSource));
```

## Environment variables

`EnvDataSource` reads `SECTION__KEY_NAME` as `section.keyName`, at any depth: `API__PORT=4000` sets `api.port`, and `DATABASE__POOL__MAX_SIZE=9` sets `database.pool.maxSize`. A name must be upper-case and hold at least one `__`; anything else is ignored.

A list can't be set this way. For a value inside one, such as in `database.dataSources`, use a `${VAR}` placeholder in the YAML.

## Typed sections

A class describes a section. Its name gives the section (`PaymentsConfig` reads `payments`), its field values are the defaults, and an optional `static schema` (JSON Schema) is checked:

```ts
export class PaymentsConfig {
	public static schema = {
		type: "object",
		required: ["provider"],
		properties: { provider: { type: "string" }, retries: { type: "integer", minimum: 0 } },
	};
	public provider!: string;
	public retries = 3;
}

builder.use(configSection(PaymentsConfig));
```

`configSection` checks the section when the app is built and makes it injectable by its class. Environment values are text, so the schema's types coerce them: `PAYMENTS__RETRIES=5` is the number 5. A bad value stops the app, naming the path and never the value, which may be a secret:

```
Invalid config in section "payments":
  - payments.retries: must be integer
```

Without `configSection`, the check runs on the first `get(PaymentsConfig)`.

## Guards

**A later layer keeps what it doesn't mention.** That is what lets `API__PORT` change one key, but it also means a setting can survive when you meant to replace it: with `auth: { provider: dev, devUser: admin }` then `auth: { provider: oidc }`, `devUser` is still `admin`. An empty section (`auth: {}`) clears nothing. To clear something, set it to null.

**Null means unset,** at any depth, inside a named list entry too: the class's default applies, or `required` fails. `auth: null` clears the whole section.

**Dev values don't belong in the base file or class defaults.** Put them in `config.dev.yaml`, and mark the key in the schema:

```ts
properties: { devUser: { type: "string", devOnly: true } }
```

A `devOnly` key with a value stops the app unless `NODE_ENV` is `development` or `dev`. Unset, staging or a typo all count as not development.

**Undeclared keys.** With `additionalProperties: false`, an unknown key stops the app, including a stray `API__X` variable. Framework sections such as `api` use it. Consider it for yours, since any `SECTION__KEY` variable becomes config once `EnvDataSource` is listed.

**Clashing variables stop the app:** `API__A` with `API__A__B`, or two names that mean the same key, such as `API__A_1` and `API__A1`.

**`__proto__`, `constructor` and `prototype`** are refused as keys, from any source.

**What these can't catch:** an ordinary value such as `host: localhost` in the base file, because nothing says it's wrong; use `${VAR}` with no default for values that differ by environment, so a missing one stops the app. A section read by name, or with no schema, skips the schema checks.
