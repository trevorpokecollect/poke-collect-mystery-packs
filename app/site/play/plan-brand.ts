// The monthly plan's customer-facing name, in ONE place. Trevor named it "Pack Pass" (Nov 25 2026, 7:09 PM CT;
// formerly "Cardbit Club"). Change PLAN here and every page, email, chat label and policy paragraph follows.
// Policies and How It Works partials use {{PLAN_NAME}} / {{PLAN_SHORT}} / {{PLAN_PATH}} tokens and wrap
// plan-only copy in <!--plan:start--> … <!--plan:end-->, which is removed while plans aren't open,
// so those pages stay accurate before and after launch.
export const PLAN = {
  /** Full name, e.g. on the plans page heading and in emails. */
  name: "Pack Pass",
  /** Short label for badges, chat room tab and icon tags. */
  short: "Pass",
  /** Plans page path. */
  path: "/pass",
} as const;

/** Member noun, e.g. "Cardbit Club members". */
export const planMembers = () => `${PLAN.name} members`;

const BLOCK = /<!--plan:start-->[\s\S]*?<!--plan:end-->/g;

/** Fill the plan tokens and keep or drop plan-only blocks. */
export function withPlanCopy(html: string, open: boolean) {
  const out = open ? html.replace(/<!--plan:(start|end)-->/g, "") : html.replace(BLOCK, "");
  return out.replaceAll("{{PLAN_NAME}}", PLAN.name).replaceAll("{{PLAN_SHORT}}", PLAN.short).replaceAll("{{PLAN_PATH}}", PLAN.path);
}

/** JSON for window.cardbitPlan (client scripts read the name from here). */
export const planClientJson = () => JSON.stringify({ name: PLAN.name, short: PLAN.short, path: PLAN.path });
