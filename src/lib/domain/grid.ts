export const GRID_VERSION='pohang-v1' as const;
const R=6371008.8,ORIGIN_LAT=36,ORIGIN_LON=129.3,REF_LAT=36.04,SIZE=200;
const RAD=Math.PI/180;
export type Cell={grid_version:typeof GRID_VERSION;cell_x:number;cell_y:number};
export function quantize(lat:number,lon:number):Cell {
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat>90||lon < -180||lon>180) throw new Error('INVALID_LOCATION');
  const cell_x=Math.floor(R*(lon-ORIGIN_LON)*RAD*Math.cos(REF_LAT*RAD)/SIZE);
  const cell_y=Math.floor(R*(lat-ORIGIN_LAT)*RAD/SIZE);
  return {grid_version:GRID_VERSION,cell_x,cell_y};
}
export function representative(cell:Cell):{lat:number;lon:number} {
  if(cell.grid_version!==GRID_VERSION||!Number.isSafeInteger(cell.cell_x)||!Number.isSafeInteger(cell.cell_y)) throw new Error('INVALID_CELL');
  return {lat:ORIGIN_LAT+(cell.cell_y+.5)*SIZE/R/RAD,
    lon:ORIGIN_LON+(cell.cell_x+.5)*SIZE/(R*Math.cos(REF_LAT*RAD))/RAD};
}
// Region eligibility is checked against server-controlled allowed_cells.
// Do not retain/send the raw input coordinates after quantize().
