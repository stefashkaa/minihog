import { context } from './internal/state.js';
import type { MiniHog, Properties } from './types.js';

export interface Survey {
  id: string;
  name: string;
  questions: { id: string; question: string; type: string; [key: string]: unknown }[];
  start_date?: string | null;
  end_date?: string | null;
  [key: string]: unknown;
}

/** Headless definitions; the application owns targeting, rendering, and sanitization. */
export async function getSurveys(client: MiniHog): Promise<Survey[]> {
  if (client.hasOptedOut()) return [];
  const current = context(client);
  try {
    const response = await (current.options.fetch ?? fetch)(
      `${client.apiHost}/api/surveys/?token=${encodeURIComponent(client.token)}`,
      {
        credentials: 'omit',
        signal: AbortSignal.timeout(current.options.requestTimeoutMs ?? 10000)
      }
    );
    if (!response.ok) throw new Error(`MiniHog surveys request failed: HTTP ${response.status}.`);
    const data = (await response.json()) as { surveys?: Survey[] };
    return client.hasOptedOut() ? [] : (data.surveys ?? []);
  } catch (error) {
    current.error(error);
    return [];
  }
}

export function surveyShown(client: MiniHog, survey: Survey): void {
  client.capture('survey shown', { $survey_id: survey.id, $survey_name: survey.name });
}

export function surveyDismissed(client: MiniHog, survey: Survey): void {
  client.capture('survey dismissed', { $survey_id: survey.id, $survey_name: survey.name });
}

export function surveySent(
  client: MiniHog,
  survey: Survey,
  responses: Record<string, string | number | string[]>
): void {
  const properties: Properties = {
    $survey_id: survey.id,
    $survey_name: survey.name,
    $survey_questions: survey.questions
  };
  for (const question of survey.questions)
    if (Object.hasOwn(responses, question.id)) properties[`$survey_response_${question.id}`] = responses[question.id];
  client.capture('survey sent', properties);
}
