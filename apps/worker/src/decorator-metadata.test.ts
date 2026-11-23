import { expect, it } from 'vitest';

const store = new Map<string, unknown>();
const R = Reflect as unknown as Record<string, unknown>;
R.metadata = (k: string, v: unknown) => (t: object) => void store.set(`${(t as { name: string }).name}:${k}`, v);
R.decorate = (decorators: Array<(t: object) => void>, t: object) => {
  decorators.forEach((d) => d(t));
  return t;
};

const Injectable = (): ClassDecorator => () => undefined;
class Dep {}

@Injectable()
class Svc {
  constructor(readonly dep: Dep) {}
}

it('emits decorator metadata (swc plugin active)', () => {
  expect(new Svc(new Dep()).dep).toBeInstanceOf(Dep);
  expect(store.get('Svc:design:paramtypes')).toEqual([Dep]);
});
