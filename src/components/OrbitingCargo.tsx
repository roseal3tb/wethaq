import { Package, Boxes } from 'lucide-react';

/**
 * Decorative logistics sculpture. No figures, status, or transaction evidence is implied.
 * Two miniature 3-D cargo cubes and two separate glowing stars orbit slowly,
 * spaced apart on their tracks around a gently floating Wethaq mark.
 */
export function OrbitingCargo({ location = 'overview' }: { location?: 'overview' | 'login' }) {
  return (
    <div className={`w-orbit w-orbit--${location}`} aria-hidden="true">
      <div className="w-orbit-grid" />
      <div className="w-orbit-ring w-orbit-ring--outer" />
      <div className="w-orbit-ring w-orbit-ring--inner" />
      <div className="w-orbit-ring w-orbit-ring--core" />
      <div className="w-orbit-track w-orbit-track--outer">
        {/* An illuminated star travels on the same track but well beside its cube. */}
        <span className="w-orbit-beacon w-orbit-beacon--upper" />
        <div className="w-orbit-satellite">
          <div className="w-cargo-cube w-cargo-cube--navy">
            <span className="w-cargo-face w-cargo-face--front"><Package size={16} strokeWidth={1.85} /></span>
            <span className="w-cargo-face w-cargo-face--top" />
            <span className="w-cargo-face w-cargo-face--right" />
          </div>
        </div>
      </div>
      <div className="w-orbit-track w-orbit-track--inner">
        <span className="w-orbit-beacon w-orbit-beacon--lower" />
        <div className="w-orbit-satellite">
          <div className="w-cargo-cube w-cargo-cube--olive">
            <span className="w-cargo-face w-cargo-face--front"><Boxes size={16} strokeWidth={1.85} /></span>
            <span className="w-cargo-face w-cargo-face--top" />
            <span className="w-cargo-face w-cargo-face--right" />
          </div>
        </div>
      </div>

      <div className="w-orbit-center-float">
        <div className="w-orbit-center-box">
          <img src="/brand/wathaq-olive-icon-light.svg" alt="" draggable={false} />
        </div>
      </div>
    </div>
  );
}
