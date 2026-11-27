// Skills extension on downstream connections: list a server's skills and read verified files.
import type { Client } from "@modelcontextprotocol/client";
import { SKILLS_EXTENSION_ID, SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import type { DownstreamSkill } from "./connector.ts";

/** Client capabilities that tell a server pMCPg understands the Skills extension. */
export const SKILLS_CLIENT_CAPABILITIES = { extensions: { [SKILLS_EXTENSION_ID]: {} } };

/** The server's skills; empty when it does not declare the extension. Invalid entries are left out. */
export async function listServerSkills(client: Client, signal?: AbortSignal): Promise<DownstreamSkill[]> {
  const skills = new SkillsClient(client, { skipInvalid: true });
  if (!skills.supported) return [];
  return (await skills.list(undefined, { signal })).skills;
}

/** One file of a listed skill. The SDK checks it is listed, and its size and digest. */
export async function readServerSkillFile(
  client: Client,
  skill: DownstreamSkill,
  uri: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  return (await new SkillsClient(client).read(skill, uri, { signal })).bytes;
}
