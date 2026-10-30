import './style.css';
import { randomSeed } from './core/rng';
import { DEFAULT_CONFIG } from './data/config';
import { Controller } from './ui/controller';

// `?seed=123` in the URL replays a specific map (and dice sequence).
const param = Number(new URLSearchParams(location.search).get('seed'));
const seed = Number.isFinite(param) && param > 0 ? param : randomSeed();

const svg = document.getElementById('board') as unknown as SVGSVGElement;
void new Controller(DEFAULT_CONFIG, svg).start(seed);
