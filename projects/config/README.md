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
