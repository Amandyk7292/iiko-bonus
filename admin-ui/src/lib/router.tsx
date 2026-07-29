import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

type NavigateOptions = {
  replace?: boolean;
  state?: unknown;
};

export type RouterLocation = {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
};

type NavigationAction = 'push' | 'replace' | 'pop';
type NavigationBlocker = (nextLocation: RouterLocation, action: NavigationAction) => boolean;

type RouterContextValue = {
  basename: string;
  location: RouterLocation;
  navigate: (to: string | number, options?: NavigateOptions) => void;
  registerBlocker: (blocker: NavigationBlocker) => () => void;
};

const RouterContext = createContext<RouterContextValue | null>(null);
const ROUTER_HISTORY_INDEX = '__bulkaAdminRouterIndex';
const ROUTER_USER_STATE = '__bulkaAdminRouterState';

const normalizeBasename = (value: string) => {
  const normalized = `/${String(value || '').replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '' : normalized;
};

const historyIndex = (state: unknown) => {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[ROUTER_HISTORY_INDEX];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const withHistoryIndex = (state: unknown, index: number) => {
  if (state && typeof state === 'object' && !Array.isArray(state)) {
    return { ...(state as Record<string, unknown>), [ROUTER_HISTORY_INDEX]: index };
  }
  return {
    [ROUTER_HISTORY_INDEX]: index,
    [ROUTER_USER_STATE]: state ?? null,
  };
};

const readLocation = (basename: string): RouterLocation => {
  const browserPath = window.location.pathname || '/';
  const pathname =
    basename && (browserPath === basename || browserPath.startsWith(`${basename}/`))
      ? browserPath.slice(basename.length) || '/'
      : browserPath;
  return {
    pathname: pathname.startsWith('/') ? pathname : `/${pathname}`,
    search: window.location.search,
    hash: window.location.hash,
    state: window.history.state,
  };
};

export function BrowserRouter({
  basename = '',
  children,
}: {
  basename?: string;
  children: ReactNode;
}) {
  const base = useMemo(() => normalizeBasename(basename), [basename]);
  const blockersRef = useRef(new Set<NavigationBlocker>());
  const historyIndexRef = useRef(0);
  const restoringPopRef = useRef(false);
  const [location, setLocation] = useState<RouterLocation>(() => {
    const existingIndex = historyIndex(window.history.state);
    historyIndexRef.current = existingIndex ?? 0;
    if (existingIndex == null) {
      window.history.replaceState(
        withHistoryIndex(window.history.state, historyIndexRef.current),
        '',
        window.location.href,
      );
    }
    return readLocation(base);
  });
  const locationRef = useRef(location);
  locationRef.current = location;

  const navigationAllowed = useCallback(
    (nextLocation: RouterLocation, action: NavigationAction) =>
      Array.from(blockersRef.current).every((blocker) => blocker(nextLocation, action)),
    [],
  );

  const registerBlocker = useCallback((blocker: NavigationBlocker) => {
    blockersRef.current.add(blocker);
    return () => {
      blockersRef.current.delete(blocker);
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextLocation = readLocation(base);
      const nextIndex = historyIndex(window.history.state);
      if (restoringPopRef.current) {
        restoringPopRef.current = false;
        if (nextIndex != null) historyIndexRef.current = nextIndex;
        locationRef.current = nextLocation;
        setLocation(nextLocation);
        return;
      }
      if (!navigationAllowed(nextLocation, 'pop')) {
        const currentLocation = locationRef.current;
        const currentIndex = historyIndexRef.current;
        if (nextIndex != null && nextIndex !== currentIndex) {
          restoringPopRef.current = true;
          window.history.go(currentIndex - nextIndex);
          return;
        }
        const currentUrl = `${base}${currentLocation.pathname}${currentLocation.search}${currentLocation.hash}`;
        window.history.pushState(
          withHistoryIndex(currentLocation.state, currentIndex),
          '',
          currentUrl,
        );
        return;
      }
      const acceptedIndex = nextIndex ?? historyIndexRef.current + 1;
      if (nextIndex == null) {
        window.history.replaceState(
          withHistoryIndex(window.history.state, acceptedIndex),
          '',
          window.location.href,
        );
      }
      historyIndexRef.current = acceptedIndex;
      locationRef.current = nextLocation;
      setLocation(nextLocation);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [base, navigationAllowed]);

  const navigate = useCallback(
    (to: string | number, options: NavigateOptions = {}) => {
      if (typeof to === 'number') {
        window.history.go(to);
        return;
      }
      const target = new URL(
        to.startsWith('/')
          ? `${base}${to}`
          : `${base}${location.pathname.replace(/\/[^/]*$/, '/')}${to}`,
        window.location.origin,
      );
      const nextUrl = `${target.pathname}${target.search}${target.hash}`;
      const targetPathname =
        base && (target.pathname === base || target.pathname.startsWith(`${base}/`))
          ? target.pathname.slice(base.length) || '/'
          : target.pathname;
      const nextLocation: RouterLocation = {
        pathname: targetPathname,
        search: target.search,
        hash: target.hash,
        state: options.state ?? null,
      };
      const action = options.replace ? 'replace' : 'push';
      if (!navigationAllowed(nextLocation, action)) return;
      const nextIndex = options.replace ? historyIndexRef.current : historyIndexRef.current + 1;
      const nextState = withHistoryIndex(options.state, nextIndex);
      if (options.replace) window.history.replaceState(nextState, '', nextUrl);
      else window.history.pushState(nextState, '', nextUrl);
      historyIndexRef.current = nextIndex;
      const resolvedLocation = readLocation(base);
      locationRef.current = resolvedLocation;
      setLocation(resolvedLocation);
    },
    [base, location.pathname, navigationAllowed],
  );

  const value = useMemo(
    () => ({ basename: base, location, navigate, registerBlocker }),
    [base, location, navigate, registerBlocker],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

const useRouter = () => {
  const value = useContext(RouterContext);
  if (!value) throw new Error('Router hooks must be used inside BrowserRouter');
  return value;
};

export const useLocation = () => useRouter().location;
export const useNavigate = () => useRouter().navigate;

export function useNavigationBlocker(
  enabled: boolean,
  blocker: (nextLocation: RouterLocation, action: NavigationAction) => boolean,
) {
  const { registerBlocker } = useRouter();
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;

  useEffect(() => {
    if (!enabled) return;
    return registerBlocker((nextLocation, action) => blockerRef.current(nextLocation, action));
  }, [enabled, registerBlocker]);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: string;
};

const shouldHandleLink = (event: MouseEvent<HTMLAnchorElement>, target?: string) =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !event.metaKey &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  (!target || target === '_self');

export function Link({ to, onClick, target, ...props }: LinkProps) {
  const { basename, navigate } = useRouter();
  const href = to.startsWith('/') ? `${basename}${to}` : to;
  return (
    <a
      {...props}
      href={href}
      target={target}
      onClick={(event) => {
        onClick?.(event);
        if (!shouldHandleLink(event, target)) return;
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}

type NavLinkProps = Omit<LinkProps, 'className'> & {
  className?: string | ((state: { isActive: boolean }) => string);
};

export function NavLink({ className, to, ...props }: NavLinkProps) {
  const { location } = useRouter();
  const targetPath = to.split(/[?#]/, 1)[0] || '/';
  const isActive =
    location.pathname === targetPath ||
    (targetPath !== '/' && location.pathname.startsWith(`${targetPath}/`));
  return (
    <Link
      {...props}
      to={to}
      className={typeof className === 'function' ? className({ isActive }) : className}
      aria-current={isActive ? 'page' : props['aria-current']}
    />
  );
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const navigate = useNavigate();
  useEffect(() => navigate(to, { replace }), [navigate, replace, to]);
  return null;
}

type RouteProps = {
  path: string;
  element: ReactNode;
};

export function Route(_props: RouteProps) {
  return null;
}

const routeMatches = (routePath: string, pathname: string) => {
  if (routePath === '*') return true;
  if (routePath === '/') return pathname === '/';
  return pathname === routePath || pathname.startsWith(`${routePath}/`);
};

export function Routes({ children }: { children: ReactNode }) {
  const { location } = useRouter();
  const routes = Children.toArray(children).filter(
    (child): child is ReactElement<RouteProps> =>
      isValidElement<RouteProps>(child) && child.type === Route,
  );
  const match =
    routes.find((route) => route.props.path !== '*' && routeMatches(route.props.path, location.pathname)) ||
    routes.find((route) => route.props.path === '*');
  return match?.props.element ?? null;
}

type SearchParamsInit = URLSearchParams | string | Record<string, string | string[]>;

export function useSearchParams(): [
  URLSearchParams,
  (next: SearchParamsInit, options?: NavigateOptions) => void,
] {
  const { basename, location, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const setParams = useCallback(
    (next: SearchParamsInit, options: NavigateOptions = {}) => {
      // A debounced filter update may fire while the next lazy route is still
      // loading and the previous page remains mounted. Never let that stale
      // callback navigate the user back to the previous route.
      if (readLocation(basename).pathname !== location.pathname) return;
      const resolved =
        next instanceof URLSearchParams
          ? new URLSearchParams(next)
          : typeof next === 'string'
            ? new URLSearchParams(next)
            : new URLSearchParams(
                Object.entries(next).flatMap(([key, value]) =>
                  Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]],
                ),
              );
      const query = resolved.toString();
      navigate(`${location.pathname}${query ? `?${query}` : ''}${location.hash}`, options);
    },
    [basename, location.hash, location.pathname, navigate],
  );
  return [params, setParams];
}
