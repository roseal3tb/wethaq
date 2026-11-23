import { OrbitingCargo } from './OrbitingCargo';

/** Decorative, quiet 3D packaging orbit in place of the former message cards. */
export function LoginFlow() {
  return <div className="login-flow" aria-hidden="true"><OrbitingCargo location="login" /></div>;
}
