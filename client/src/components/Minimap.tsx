import { clamp } from '@angulio/shared';

interface MinimapProps {
  position?: { x: number; y: number };
  playerMass?: number;
  mapSize: number;
}

export default function Minimap({ position, playerMass, mapSize }: MinimapProps) {
  const effectiveSize = mapSize > 0 ? mapSize : 15000;
  const posX = position ? clamp(position.x, 0, effectiveSize) : effectiveSize / 2;
  const posY = position ? clamp(position.y, 0, effectiveSize) : effectiveSize / 2;

  const pctX = (posX / effectiveSize) * 100;
  const pctY = (posY / effectiveSize) * 100;

  // Calcul du diamètre réel du morceau mis à l'échelle sur la grille de la minimap (250px)
  const gridDimensionPx = 250;
  const playerRadiusUnits = Math.sqrt(playerMass || 50);
  const playerDiameterUnits = playerRadiusUnits * 2;
  const scaledDiameterPx = (playerDiameterUnits / effectiveSize) * gridDimensionPx;
  const dotDiameter = Math.max(6, Math.min(60, Math.round(scaledDiameterPx)));

  const colIdx = Math.min(2, Math.floor((posX / effectiveSize) * 3));
  const rowIdx = Math.min(2, Math.floor((posY / effectiveSize) * 3));

  const rowLetters = ['A', 'B', 'C'];
  const sector = `${rowLetters[rowIdx]}${colIdx + 1}`;

  const cells = [
    { label: 'A1' },
    { label: 'A2' },
    { label: 'A3' },
    { label: 'B1' },
    { label: 'B2' },
    { label: 'B3' },
    { label: 'C1' },
    { label: 'C2' },
    { label: 'C3' },
  ];

  return (
    <div className="minimap-container" aria-label="Minimap">
      <div className="minimap-header">
        <span>1</span>
        <span>2</span>
        <span>3</span>
      </div>
      <div className="minimap-body">
        <div className="minimap-rows-labels">
          <span>A</span>
          <span>B</span>
          <span>C</span>
        </div>
        <div className="minimap-grid">
          {cells.map((c) => (
            <div key={c.label} className="minimap-cell">
              {c.label}
            </div>
          ))}
          <div
            className="minimap-player-dot"
            style={{
              left: `${pctX}%`,
              top: `${pctY}%`,
              width: `${dotDiameter}px`,
              height: `${dotDiameter}px`,
            }}
          />
        </div>
      </div>
      <div className="minimap-sector-tag">Secteur {sector}</div>
    </div>
  );
}
