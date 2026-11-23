import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class UserEntity {
	@PrimaryGeneratedColumn()
	public id!: number;

	@Column({ unique: true })
	public sub!: string;

	@Column({ type: "varchar", nullable: true })
	public email!: string | null;

	@Column()
	public displayName!: string;

	/** App-owned roles. The `admin` role grants CASL `manage`/`all` (wildcard). */
	@Column({ type: "simple-json", default: "[]" })
	public roles!: string[];
}
