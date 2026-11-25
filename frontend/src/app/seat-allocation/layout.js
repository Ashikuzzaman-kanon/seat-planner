/*
 * The public Seat Allocation page's title and description: what a search
 * engine lists and what a shared link shows.
 */
export const metadata = {
  title: "Seat Allocation — which trains have seats | Seat Planner",
  description:
    "See which Bangladesh Railway trains have seats set aside for your journey, class by class — prepared from the " +
    "railway's official e-ticket site. Free, no account needed.",
  openGraph: {
    title: "Seat Allocation — which trains have seats",
    description:
      "Which trains have seats set aside for your journey, class by class. Free, no account needed.",
    type: "website",
  },
};

export default function SeatAllocationLayout({ children }) {
  return children;
}
