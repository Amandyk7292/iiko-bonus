import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

type RouterLocation = {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
};

type RouterContextValue = {
  basename: string;
  location: RouterLocation;
  navigate: (to: string | number, options?: NavigateOptions) => void;
};

const RouterContext = createContext<RouterContextValue | null>(null);

const normalizeBasename = (value: string) => {
  const normalized = `/${String(value || '').replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '' : normalized;
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
  const [location, setLocation] = useState<RouterLocation>(() => readLocation(base));

  useEffect(() => {
    const handlePopState = () => setLocation(readLocation(base));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [base]);

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
      if (options.replace) window.history.replaceState(options.state ?? null, '', nextUrl);
      else window.history.pushState(options.state ?? null, '', nextUrl);
      setLocation(readLocation(base));
    },
    [base, location.pathname],
  );

  const value = useMemo(
    () => ({ basename: base, location, navigate }),
    [base, location, navigate],
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
