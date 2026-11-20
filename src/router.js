// Path routing: <base>/studio (editor) and <base>/play (walk-through).
//
// <base> is whatever the app is served under ("/" locally, "/v1/" behind a
// proxy), worked out from the current URL, so no build-time config is needed.
// Paths have no trailing slash: "/v1/play", not "/v1/play/" — the relative
// ./assets/ URLs depend on it.

const ROUTE_RE = /^(.*\/)(studio|play)$/;
const DEFAULT_ROUTE = 'play'; // the bare base URL ("/" or "/v1/") opens the walk-through

function parse() {
  const path = location.pathname;
  const m = path.match(ROUTE_RE);
  if (m) return { base: m[1], route: m[2] };
  return { base: path.slice(0, path.lastIndexOf('/') + 1), route: DEFAULT_ROUTE };
}

export function initRouter(game) {
  const { base } = parse();
  let applying = false; // true while reacting to the URL, so we don't push it again

  const setUrl = (route, push) => {
    const path = base + route;
    if (location.pathname === path) return;
    history[push ? 'pushState' : 'replaceState']({ route }, '', path + location.search + location.hash);
  };

  const apply = () => {
    const { route } = parse();
    applying = true;
    if (route === 'play' && !game.active) game.enter();
    else if (route === 'studio' && game.active) game.exit();
    applying = false;
    document.title = route === 'play' ? 'Room Studio · Play' : 'Room Studio';
  };

  // Play button / Exit button / Esc -> update the URL (adds a history entry).
  game.onModeChange = (active) => {
    if (applying) return;
    setUrl(active ? 'play' : 'studio', true);
    document.title = active ? 'Room Studio · Play' : 'Room Studio';
  };

  window.addEventListener('popstate', apply);

  // First load: "/" or "/v1/" is replaced with ".../play"; ".../studio" opens the editor.
  setUrl(parse().route, false);
  apply();
}
