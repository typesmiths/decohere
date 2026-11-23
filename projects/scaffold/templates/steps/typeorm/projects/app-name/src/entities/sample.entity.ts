import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class SampleEntity {
	@PrimaryGeneratedColumn()
	public id!: number;

	@Column()
	public name!: string;
}
