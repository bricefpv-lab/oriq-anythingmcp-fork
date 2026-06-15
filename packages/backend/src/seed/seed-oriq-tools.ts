/**
 * seed-oriq-tools.ts — Seed idempotent des tools oriq-spécifiques.
 *
 * Couvre les tools qui ne peuvent pas être recréés via l'UI AMCP car ils
 * n'ont pas d'équivalent dans le catalogue adapters upstream.
 * Appelé depuis start.sh à chaque boot, APRÈS prisma migrate deploy.
 * Fail-soft : log + continue si le connector est absent ou si Prisma échoue.
 *
 * Source de vérité documentaire : connectors/*.manifest.json (oriq-edge).
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

interface ToolDef {
  name: string;
  description: string;
  parameters: object;
  endpointMapping: object;
}

const ORIQ_TOOLS: Record<string, ToolDef[]> = {
  'HubSpot CRM': [
    {
      name: 'hubspot_crm_v3_objects_notes_post_search',
      description:
        'Cherche les notes HubSpot associées à un contact, une entreprise ou un deal. ' +
        'Utiliser filterGroups avec associations.contact/company/deal EQ <id>. ' +
        'Retourne id, hs_note_body, hs_timestamp.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20 },
          sorts: { type: 'array' },
          properties: { type: 'array', items: { type: 'string' } },
          filterGroups: { type: 'array' },
        },
      },
      endpointMapping: {
        method: 'POST',
        path: '/crm/v3/objects/notes/search',
        bodyMapping: { passthrough: true },
      },
    },
    {
      name: 'hubspot_crm_v3_objects_tasks_post_search',
      description:
        'Cherche les tâches HubSpot associées à un contact, une entreprise ou un deal. ' +
        'Utiliser filterGroups avec associations.contact/company/deal EQ <id>. ' +
        'Retourne id, hs_task_subject, hs_task_status, hs_timestamp.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20 },
          sorts: { type: 'array' },
          properties: { type: 'array', items: { type: 'string' } },
          filterGroups: { type: 'array' },
        },
      },
      endpointMapping: {
        method: 'POST',
        path: '/crm/v3/objects/tasks/search',
        bodyMapping: { passthrough: true },
      },
    },
  ],

  'Microsoft Graph (365)': [
    {
      name: 'microsoft_outlook_search_messages',
      description:
        'Recherche des emails Outlook via Microsoft Graph (KQL). ' +
        'Utiliser les operateurs : from:email, to:email, subject:mot, ' +
        'received>=2024-01-01, hasAttachments:true. ' +
        'Exemple : "from:alice@acme.com subject:devis".',
      parameters: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            description:
              'Requete KQL Outlook. Operateurs : from:email, to:email, ' +
              'subject:mot, received>=YYYY-MM-DD, hasAttachments:true.',
          },
          maxResults: {
            type: 'integer',
            default: 10,
            description: 'Nombre max de messages a retourner (defaut : 10, max : 50).',
          },
        },
      },
      endpointMapping: {
        method: 'GET',
        path: '/v1.0/me/messages',
        queryParams: {
          $top: '$maxResults',
          $search: '$query',
          $select: 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,body',
        },
      },
    },
  ],

  Pennylane: [
    {
      name: 'pennylane_list_customers',
      description:
        'Liste les clients Pennylane avec pagination curseur ' +
        '(resolution customer_id vers nom).',
      parameters: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            description:
              'Cursor de pagination — valeur next_cursor de la reponse precedente. ' +
              'Absent pour la premiere page.',
          },
        },
      },
      endpointMapping: {
        method: 'GET',
        path: '/api/external/v2/customers',
        queryParams: { limit: 100, cursor: '$cursor' },
      },
    },
  ],
};

async function main(): Promise<void> {
  console.log('[seed-oriq-tools] Demarrage seed idempotent...');

  for (const [connectorName, tools] of Object.entries(ORIQ_TOOLS)) {
    let connector: { id: string } | null = null;
    try {
      connector = await prisma.connector.findFirst({
        where: { name: connectorName, isActive: true },
        select: { id: true },
      });
    } catch (e) {
      console.warn(
        `[seed-oriq-tools] Impossible de lire connector '${connectorName}': ` +
          (e instanceof Error ? e.message : String(e)),
      );
      continue;
    }

    if (!connector) {
      console.log(
        `[seed-oriq-tools] Connector '${connectorName}' absent en DB — skip.`,
      );
      continue;
    }

    for (const tool of tools) {
      try {
        const existing = await prisma.mcpTool.findFirst({
          where: { connectorId: connector.id, name: tool.name },
          select: { id: true },
        });

        if (existing) {
          console.log(`[seed-oriq-tools] Tool '${tool.name}' deja present — skip.`);
          continue;
        }

        await prisma.mcpTool.create({
          data: {
            connectorId: connector.id,
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            endpointMapping: tool.endpointMapping,
            isEnabled: true,
          },
        });
        console.log(`[seed-oriq-tools] Tool '${tool.name}' cree.`);
      } catch (e) {
        console.warn(
          `[seed-oriq-tools] Echec creation tool '${tool.name}': ` +
            (e instanceof Error ? e.message : String(e)),
        );
      }
    }
  }

  console.log('[seed-oriq-tools] Termine.');
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('[seed-oriq-tools] Erreur fatale:', e);
    prisma.$disconnect().catch(() => undefined);
  });
