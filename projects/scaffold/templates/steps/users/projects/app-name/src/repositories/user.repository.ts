import { injectable } from "@decohere/crucible/decorators";
import { injectUnitOfWork, type IUnitOfWork, Repository } from "@decohere/data";
import { UserEntity } from "../entities/user.entity.js";

@injectable()
export class UserEntityRepository extends Repository<UserEntity> {
	public constructor(@injectUnitOfWork() unitOfWork: IUnitOfWork) {
		super(unitOfWork, UserEntity);
	}

	public findBySub(sub: string): Promise<UserEntity | null> {
		return this.findOne({ where: { sub } });
	}
}
