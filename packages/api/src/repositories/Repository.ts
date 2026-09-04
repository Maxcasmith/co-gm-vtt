import type { Entity } from "@entities/Entity";

export interface ListDTOInterface {
  maximum: number;
  offset: number;
}

export interface UpdateDTOInterface<G extends Entity> {
  id: string;
  data: Partial<G>;
}

export interface DeleteDTOInterface {
  id: string;
}

export interface Repository<G extends Entity> {
  list(blueprints: ListDTOInterface): Promise<G[]>;
  create(blueprints: Partial<G>): Promise<G>;
  update(blueprints: UpdateDTOInterface<G>): Promise<G>;
  delete(blueprints: DeleteDTOInterface): Promise<boolean>;
  find(blueprints: Partial<G>): Promise<G | null>;
}
