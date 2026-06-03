import { after, type NextRequest } from "next/server";
import { syncCalendarAgendaForUser } from "@/lib/google-calendar-agenda-service";
import {
  parseCalendarWatchNotification,
  recordCalendarWatchNotification,
  validateCalendarWatchNotification,
} from "@/lib/google-calendar-watch";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const notification = parseCalendarWatchNotification(request.headers);

  if (
    !notification.channelId ||
    !notification.channelToken ||
    !notification.resourceState ||
    typeof notification.messageNumber !== "number" ||
    !Number.isFinite(notification.messageNumber) ||
    notification.messageNumber <= 0
  ) {
    return new Response(null, { status: 400 });
  }

  const validation = await validateCalendarWatchNotification(notification);
  if (!validation.channel) {
    return new Response(null, { status: validation.responseStatus });
  }
  const { channel } = validation;

  await recordCalendarWatchNotification({ channel, notification });

  after(async () => {
    await syncCalendarAgendaForUser({
      userId: channel.user_id,
      organizationId: channel.organization_id,
      calendarId: channel.calendar_id,
    }).catch(() => undefined);
  });

  return new Response(null, { status: 202 });
}
