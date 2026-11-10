export class UserEntity {
	public id!: number;
	public sub!: string;
	public email!: string | null;
	public displayName!: string;
	/** App-owned roles. The `admin` role grants CASL `manage`/`all` (wildcard). */
	public roles!: string[];
}
