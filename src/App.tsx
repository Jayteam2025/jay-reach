import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { MotionConfig } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "sonner";
import { AuthGate } from "@/components/auth/AuthGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const Prospection = lazy(() => import("./pages/Prospection"));
const queryClient = new QueryClient();

export default function App() {
  return (
    <HelmetProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <MotionConfig reducedMotion="user">
          <QueryClientProvider client={queryClient}>
            <TooltipProvider>
              <BrowserRouter>
                <ErrorBoundary>
                  <AuthGate>
                    <Suspense fallback={null}>
                      <Routes>
                        <Route path="/" element={<Prospection />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Routes>
                    </Suspense>
                  </AuthGate>
                </ErrorBoundary>
                <Toaster richColors position="bottom-right" />
              </BrowserRouter>
            </TooltipProvider>
          </QueryClientProvider>
        </MotionConfig>
      </ThemeProvider>
    </HelmetProvider>
  );
}
