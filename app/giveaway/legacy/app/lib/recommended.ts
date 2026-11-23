import type { ActionType } from "@prisma/client";
import {
  newAction,

  type ActionConfigForm,
  type CampaignFormValues,
} from "./campaign-form";


interface Recommended {
  type: ActionType;
  label: string;
  entries: number;
  repeatable?: boolean;
  /** Required to enter: no entries count in a draw until it's done. */
  mandatory?: boolean;
  config?: ActionConfigForm;
}

// The account-level Whatnot gate and the three social bonuses are owned by Cardbit's entry ledger.
const ACTIONS: Recommended[] = [
  {type:"SIGNUP",label:"Enter the giveaway",entries:1},
  {type:"REFERRAL",label:"Refer a friend who makes a purchase",entries:500},
  {type:"DAILY_CHECKIN",label:"Daily check-in",entries:1,repeatable:true},
];
const sameAction = (
  a: { type: ActionType; config: ActionConfigForm },
  r: Recommended,
) =>
  a.type === r.type &&
  ((r.type !== "SOCIAL_FOLLOW" && r.type !== "VISIT_URL") ||
    a.config.url === r.config?.url);

/** Keeps existing actions (updating matching ones' entries) and adds missing ones. */
function mergeActions(
  current: CampaignFormValues["actions"],
  list: Recommended[],
) {
  const actions = current.map((a) => {
    const r = list.find((x) => sameAction(a, x));
    return r
      ? {
          ...a,
          entries: r.entries,
          repeatable: r.repeatable ?? a.repeatable,
          mandatory: r.mandatory ?? a.mandatory,
        }
      : a;
  });
  for (const r of list) {
    if (actions.some((a) => sameAction(a, r))) continue;
    actions.push({
      ...newAction(r.type),
      label: r.label,
      entries: r.entries,
      repeatable: r.repeatable ?? false,
      mandatory: r.mandatory ?? newAction(r.type).mandatory,
      config: { ...newAction(r.type).config, ...r.config },
    });
  }
  return actions;
}

/**
 * Returns `v` with the recommended actions, purchase rules and settings.
 * Keeps the title, prize, dates, image, link name and rules text, keeps any
 * existing actions (updating the entries of matching ones) and keeps product
 * rules, bundles and the Klaviyo list id, which are store-specific.
 */
export function applyRecommended(v: CampaignFormValues): CampaignFormValues {
  return {
    ...v,
    actions: mergeActions(v.actions,ACTIONS),
    rules: {...v.rules,enabled:false,autoSignupFromOrders:false,periodMultipliers:[]},
    settings: {...v.settings,usOnly:true,requireEmailConsent:true},
  };
}
export function applyRecommendedDaily(v: CampaignFormValues): CampaignFormValues {
  const base=applyRecommended(v);
  return {...base,timezone:"America/Chicago",settings:{...base.settings,daily:{...base.settings.daily,enabled:true,drawTime:"20:00"}}};
}
export const applyLiveMonthly=applyRecommended;
