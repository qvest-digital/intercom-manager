import { Log } from './log';
import {
  Conference,
  DetailedConference,
  SmbAudioEndpointDescription,
  SmbEndpointDescription
} from './models';

interface AllocateConferenceResponse {
  id: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// The Symphony Media Bridge legacy API represents codec lists as a
// `payload-types` array, whereas intercom-manager models a single
// `payload-type`. These helpers translate at the SMB boundary so the rest of
// the codebase can keep using the singular form unchanged.

// Collapse `payload-types` (array) into a single `payload-type`. For audio we
// prefer Opus; otherwise the first entry is used.
function collapsePayloadTypes(media: any, preferredName?: string): void {
  if (!media || typeof media !== 'object') {
    return;
  }
  const payloadTypes = media['payload-types'];
  if (Array.isArray(payloadTypes) && media['payload-type'] === undefined) {
    let selected = payloadTypes[0];
    if (preferredName) {
      const preferred = payloadTypes.find(
        (pt) =>
          typeof pt?.name === 'string' &&
          pt.name.toLowerCase() === preferredName.toLowerCase()
      );
      if (preferred) {
        selected = preferred;
      }
    }
    if (selected !== undefined) {
      media['payload-type'] = selected;
    }
    delete media['payload-types'];
  }
}

// Expand a singular `payload-type` back into the SMB `payload-types` array form.
function expandPayloadType(media: any): void {
  if (!media || typeof media !== 'object') {
    return;
  }
  if (media['payload-type'] !== undefined && media['payload-types'] === undefined) {
    media['payload-types'] = [media['payload-type']];
    delete media['payload-type'];
  }
}

// Normalize an SMB endpoint-description response into the singular form the
// manager expects.
function normalizeSmbResponse<T>(description: T): T {
  const desc = description as any;
  if (desc && typeof desc === 'object') {
    collapsePayloadTypes(desc.audio, 'opus');
    collapsePayloadTypes(desc.video);
  }
  return description;
}

// Convert an endpoint description that uses the singular `payload-type` back
// into the array form the SMB legacy API accepts on configure.
function denormalizeForSmb(request: any): any {
  if (request && typeof request === 'object') {
    expandPayloadType(request.audio);
    expandPayloadType(request.video);
  }
  return request;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface BaseAllocationRequest {
  action: string;
  'bundle-transport': {
    'ice-controlling': boolean;
    ice: boolean;
    dtls: boolean;
    sdes: boolean;
  };
  audio?: object;
  video?: object;
  data?: object;
  idleTimeout?: number;
}

interface AudioAllocationRequest {
  action: string;
  audio?: object;
  data?: object;
  idleTimeout?: number;
}

export interface ISmbProtocol {
  allocateConference(smbUrl: string, smbKey: string): Promise<string>;
  allocateEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    audio: boolean,
    data: boolean,
    iceControlling: boolean,
    relayType: 'ssrc-rewrite' | 'forwarder' | 'mixed',
    idleTimeout: number,
    smbKey: string
  ): Promise<SmbEndpointDescription>;
  allocateAudioEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    relayType: 'ssrc-rewrite' | 'forwarder',
    idleTimeout: number,
    smbKey: string
  ): Promise<SmbAudioEndpointDescription>;
  configureEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    smbKey: string
  ): Promise<void>;
  getConferences(smbUrl: string, smbKey: string): Promise<string[]>;
  getConferencesWithUsers(
    smbUrl: string,
    smbKey: string
  ): Promise<Conference[]>;
  getConference(
    smbUrl: string,
    conferenceId: string,
    smbKey: string
  ): Promise<DetailedConference[]>;
}

export class SmbProtocol implements ISmbProtocol {
  async allocateConference(smbUrl: string, smbKey: string): Promise<string> {
    const allocateResponse = await fetch(smbUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      },
      body: '{}'
    });

    if (!allocateResponse.ok) {
      throw new Error(
        `Failed to allocate conference: ${JSON.stringify(
          allocateResponse
        )}, responds with: ${allocateResponse.statusText}`
      );
    }

    const allocateResponseJson: AllocateConferenceResponse =
      (await allocateResponse.json()) as AllocateConferenceResponse;
    return allocateResponseJson['id'];
  }

  async allocateEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    audio: boolean,
    data: boolean,
    iceControlling: boolean,
    relayType: 'ssrc-rewrite' | 'forwarder' | 'mixed',
    idleTimeout: number,
    smbKey: string
  ): Promise<SmbEndpointDescription> {
    const request: BaseAllocationRequest = {
      action: 'allocate',
      'bundle-transport': {
        'ice-controlling': iceControlling,
        ice: true,
        dtls: true,
        sdes: false
      },
      audio: {
        ssrcs: []
      },
      video: {
        ssrcs: []
      }
    };

    if (audio) {
      request['audio'] = { 'relay-type': relayType };
    }

    if (data) {
      request['data'] = {};
    }
    if (idleTimeout) {
      request['idleTimeout'] = idleTimeout;
    }
    Log().debug(request);

    const url = smbUrl + conferenceId + '/' + endpointId;
    Log().debug(url);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(
        `Failed to allocate endpoint:  ${JSON.stringify(
          request
        )}, responds with: ${response.statusText}`
      );
    }

    const smbEndpointDescription: SmbEndpointDescription = normalizeSmbResponse(
      (await response.json()) as SmbEndpointDescription
    );

    return smbEndpointDescription;
  }

  async allocateAudioEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    relayType: 'ssrc-rewrite' | 'forwarder',
    idleTimeout: number,
    smbKey: string
  ): Promise<SmbAudioEndpointDescription> {
    const request: AudioAllocationRequest = {
      action: 'allocate',
      audio: {
        'relay-type': relayType,
        transport: {
          ice: true,
          dtls: true,
          sdes: false
        }
      },
      idleTimeout: idleTimeout
    };

    Log().debug(request);

    const url = smbUrl + conferenceId + '/' + endpointId;
    Log().debug(url);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      throw new Error(
        `Failed to allocate endpoint:  ${JSON.stringify(
          request
        )}, responds with: ${response.statusText}`
      );
    }

    const smbEndpointDescription: SmbAudioEndpointDescription =
      normalizeSmbResponse(
        (await response.json()) as SmbAudioEndpointDescription
      );

    return smbEndpointDescription;
  }

  async configureEndpoint(
    smbUrl: string,
    conferenceId: string,
    endpointId: string,
    endpointDescription: SmbEndpointDescription,
    smbKey: string
  ): Promise<void> {
    const request = denormalizeForSmb(
      JSON.parse(JSON.stringify(endpointDescription))
    );
    request['action'] = 'configure';
    const url = smbUrl + conferenceId + '/' + endpointId;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const contentType = response.headers.get('content-type');

      let text;
      let json;

      if (contentType && contentType.indexOf('text/plain') > -1) {
        text = await response.text();
      } else if (contentType && contentType.indexOf('application/json') > -1) {
        json = await response.json();
      }

      throw new Error(
        `Failed to configure endpoint ${text ? text : JSON.stringify(json)}`
      );
    }
  }

  async getConferences(smbUrl: string, smbKey: string): Promise<string[]> {
    const response = await fetch(smbUrl, {
      method: 'GET',
      headers: {
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      }
    });

    if (!response.ok) {
      return [];
    }

    const responseBody: string[] = (await response.json()) as string[];
    return responseBody;
  }

  async getConferencesWithUsers(
    smbUrl: string,
    smbKey: string
  ): Promise<Conference[]> {
    const url = smbUrl + '?brief';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return [];
      }

      const responseBody: Conference[] =
        (await response.json()) as Conference[];
      return responseBody;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getConference(
    smbUrl: string,
    conferenceId: string,
    smbKey: string
  ): Promise<DetailedConference[]> {
    const url = smbUrl + conferenceId;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(smbKey !== '' && { Authorization: `Bearer ${smbKey}` })
      }
    });

    if (!response.ok) {
      return [];
    }

    const responseBody: DetailedConference[] =
      (await response.json()) as DetailedConference[];
    return responseBody;
  }
}
