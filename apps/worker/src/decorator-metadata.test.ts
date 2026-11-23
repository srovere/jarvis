import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { expect, it } from 'vitest';

class Dep {}

@Injectable()
class Svc {
  constructor(readonly dep: Dep) {}
}

it('emits decorator metadata (swc plugin active)', () => {
  expect(new Svc(new Dep()).dep).toBeInstanceOf(Dep);
  expect(Reflect.getMetadata('design:paramtypes', Svc)).toEqual([Dep]);
});
