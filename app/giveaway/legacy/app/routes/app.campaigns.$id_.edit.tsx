import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { CampaignForm } from "../components/CampaignForm";
import {
  actionHistoryInclude,
  campaignToForm,
  duplicateCampaign,
  loadResourceLabels,
  readCampaignForm,
  ruleResourceIds,
  slugTaken,
  updateCampaign,
} from "../lib/campaign-form.server";
import { currentPrize } from "../lib/daily.server";
import { isArchivedAction } from "../lib/settings";

// "$id_" keeps this page out of app.campaigns.$id's layout (that page has no
// <Outlet>); the URL is still /staff/cardbit-campaigns/campaigns/:id/edit.

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
    include: actionHistoryInclude,
  });
  if (!campaign) throw new Response("Not found", { status: 404 });

  const resources = await loadResourceLabels(
    admin.graphql,
    ruleResourceIds(campaign.purchaseRules),
  );
  const today = await currentPrize(campaign);
  return {
    id: campaign.id,
    title: campaign.title,
    dailyPrize: today?.prize
      ? { title: today.prize.title, imageUrl: today.prize.imageUrl }
      : null,
    initial: campaignToForm(campaign, resources),
    archivedCount: campaign.actions.filter((a) => isArchivedAction(a.config))
      .length,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const campaign = await db.campaign.findFirst({
    where: { id: params.id, shop: session.shop },
  });
  if (!campaign) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  const audit = (action: string, target: string) =>
    db.auditLog.create({ data: { shop: session.shop, action, target } });

  // Posted from the campaign page's Duplicate button.
  if (form.get("intent") === "duplicate") {
    const copy = await duplicateCampaign(session.shop, campaign.id);
    if (!copy) throw new Response("Not found", { status: 404 });
    await audit("campaign.duplicate", copy.id);
    return redirect(`/staff/cardbit-campaigns/campaigns/${copy.id}/edit`);
  }

  const parsed = await readCampaignForm(form);
  if ("error" in parsed) return { error: parsed.error };
  const { data, image } = parsed;
  if (await slugTaken(session.shop, data.slug, campaign.id)) {
    return { error: `A giveaway with the link "${data.slug}" already exists.` };
  }

  await updateCampaign(campaign, data, image);
  await audit("campaign.update", campaign.id);
  return redirect(`/staff/cardbit-campaigns/campaigns/${campaign.id}`);
};

export default function EditCampaign() {
  const { id, title, initial, archivedCount, dailyPrize } =
    useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const saving = useNavigation().state === "submitting";

  return (
    <s-page heading={`Edit ${title}`} inlineSize="large">
      <s-link slot="breadcrumb-actions" href={`/staff/cardbit-campaigns/campaigns/${id}`}>
        {title}
      </s-link>
      <CampaignForm
        key={id}
        initial={initial}
        submitLabel="Save giveaway"
        saving={saving}
        error={result?.error}
        archivedCount={archivedCount}
        dailyPrize={dailyPrize}
        isEdit
      />
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
