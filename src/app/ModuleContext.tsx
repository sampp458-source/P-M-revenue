import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  getModuleFromPath,
  hasCompletedModuleGate,
  markModuleGateComplete,
  readLastModulePath,
  readPendingReturnTo,
  resolveModuleDestination,
  safePendingReturnTo,
  writeLastModulePath,
  writePendingReturnTo,
  type AppModule,
} from "./moduleState";

interface ModuleContextValue {
  currentModule: ReturnType<typeof getModuleFromPath>;
  gateCompleted: boolean;
  pendingReturnTo: string | null;
  rememberPendingReturnTo: (value: unknown) => void;
  chooseModule: (module: AppModule, pendingOverride?: unknown) => void;
  switchModule: (module: AppModule) => void;
}

const ModuleContext = createContext<ModuleContextValue | null>(null);

export function ModuleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [gateState, setGateState] = useState<{
    userId: string | null;
    completed: boolean;
  }>({ userId: null, completed: false });
  const [pendingReturnTo, setPendingReturnTo] = useState<string | null>(null);
  const currentModule = getModuleFromPath(location.pathname);
  const gateCompleted = user
    ? gateState.userId === user.id
      ? gateState.completed
      : hasCompletedModuleGate(user.id)
    : false;

  useEffect(() => {
    if (!user) {
      setGateState({ userId: null, completed: false });
      setPendingReturnTo(null);
      return;
    }
    setGateState({
      userId: user.id,
      completed: hasCompletedModuleGate(user.id),
    });
    setPendingReturnTo(readPendingReturnTo(user.id));
  }, [user]);

  useEffect(() => {
    if (!user || !gateCompleted) return;
    if (
      currentModule !== "finance" &&
      currentModule !== "operations" &&
      currentModule !== "journal"
    ) return;
    writeLastModulePath(
      user.id,
      currentModule,
      `${location.pathname}${location.search}${location.hash}`,
    );
  }, [
    currentModule,
    gateCompleted,
    location.hash,
    location.pathname,
    location.search,
    user,
  ]);

  const rememberPendingReturnTo = useCallback(
    (value: unknown) => {
      if (!user) return;
      const safeValue = safePendingReturnTo(value);
      writePendingReturnTo(user.id, safeValue);
      setPendingReturnTo(safeValue);
    },
    [user],
  );

  const destinationFor = useCallback(
    (target: AppModule, pendingOverride?: unknown) => {
      if (!user) {
        if (target === "finance") return "/dashboard";
        return target === "operations" ? "/operations/today" : "/journal/today";
      }
      return resolveModuleDestination({
        target,
        pendingReturnTo: safePendingReturnTo(pendingOverride) ?? pendingReturnTo,
        lastFinancePath: readLastModulePath(user.id, "finance"),
        lastOperationsPath: readLastModulePath(user.id, "operations"),
        lastJournalPath: readLastModulePath(user.id, "journal"),
      });
    },
    [pendingReturnTo, user],
  );

  const chooseModule = useCallback(
    (target: AppModule, pendingOverride?: unknown) => {
      if (!user) return;
      const destination = destinationFor(target, pendingOverride);
      markModuleGateComplete(user.id);
      writePendingReturnTo(user.id, null);
      setPendingReturnTo(null);
      setGateState({ userId: user.id, completed: true });
      navigate(destination, { replace: true });
    },
    [destinationFor, navigate, user],
  );

  const switchModule = useCallback(
    (target: AppModule) => {
      if (!user || target === currentModule) return;
      navigate(destinationFor(target));
    },
    [currentModule, destinationFor, navigate, user],
  );

  const value = useMemo<ModuleContextValue>(
    () => ({
      currentModule,
      gateCompleted,
      pendingReturnTo,
      rememberPendingReturnTo,
      chooseModule,
      switchModule,
    }),
    [
      chooseModule,
      currentModule,
      gateCompleted,
      pendingReturnTo,
      rememberPendingReturnTo,
      switchModule,
    ],
  );

  return (
    <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>
  );
}

export function useModule() {
  const value = useContext(ModuleContext);
  if (!value) throw new Error("ModuleProvider가 필요합니다.");
  return value;
}
