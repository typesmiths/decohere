import { injectable } from "@decohere/crucible/decorators";
import { injectUnitOfWork, type IUnitOfWork, Repository } from "@decohere/data";
import { SampleEntity } from "../entities/sample.entity.js";

@injectable()
export class SampleEntityRepository extends Repository<SampleEntity> {
	public constructor(@injectUnitOfWork() unitOfWork: IUnitOfWork) {
		super(unitOfWork, SampleEntity);
	}
}
