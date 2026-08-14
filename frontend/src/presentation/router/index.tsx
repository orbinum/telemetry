/**
 * Routes. The chain lives in the URL so a view is shareable and the
 * testnet/mainnet split is just a link (plan §8).
 */

import { Navigate, createBrowserRouter } from "react-router";
import { AppLayout } from "../layouts/AppLayout";
import { ChainLayout } from "../layouts/ChainLayout";
import { NodeListPage } from "../pages/NodeListPage";
import { StatsPage } from "../pages/StatsPage";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        element: <ChainLayout />,
        children: [
          // No chain in the URL: the layout picks the most recent one.
          { path: "/", element: <NodeListPage /> },
          { path: "/chain/:genesisHash", element: <NodeListPage /> },
          { path: "/chain/:genesisHash/stats", element: <StatsPage /> },
        ],
      },
      // Anything else — an old bookmark, a removed page — lands on the node
      // list rather than react-router's raw error screen.
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
