// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/* eslint-disable max-classes-per-file */

import protobuf from '../protobuf/wrap';

import { SignalService as Proto } from '../protobuf';
import { normalizeUuid } from '../util/normalizeUuid';
import * as log from '../logging/log';

import Avatar = Proto.ContactDetails.IAvatar;

const { Reader } = protobuf;

type OptionalAvatar = { avatar?: Avatar | null };

type DecoderBase<Message extends OptionalAvatar> = {
  decodeDelimited(reader: protobuf.Reader): Message | undefined;
};

export type MessageWithAvatar<Message extends OptionalAvatar> = Omit<
  Message,
  'avatar'
> & {
  avatar?: (Avatar & { data: Uint8Array }) | null;
};

export type ModifiedGroupDetails = MessageWithAvatar<Proto.GroupDetails>;

export type ModifiedContactDetails = MessageWithAvatar<Proto.ContactDetails>;

abstract class ParserBase<
  Message extends OptionalAvatar,
  Decoder extends DecoderBase<Message>,
  Result
> implements Iterable<Result>
{
  protected readonly reader: protobuf.Reader;

  constructor(bytes: Uint8Array, private readonly decoder: Decoder) {
    this.reader = new Reader(bytes);
  }

  protected decodeDelimited(): MessageWithAvatar<Message> | undefined {
    if (this.reader.pos === this.reader.len) {
      return undefined; // eof
    }

    try {
      const proto = this.decoder.decodeDelimited(this.reader);

      if (!proto) {
        return undefined;
      }

      if (!proto.avatar) {
        return {
          ...proto,
          avatar: null,
        };
      }

      const attachmentLen = proto.avatar.length ?? 0;
      const avatarData = this.reader.buf.slice(
        this.reader.pos,
        this.reader.pos + attachmentLen
      );
      this.reader.skip(attachmentLen);

      return {
        ...proto,

        avatar: {
          ...proto.avatar,

          data: avatarData,
        },
      };
    } catch (error) {
      log.error(
        'ProtoParser.next error:',
        error && error.stack ? error.stack : error
      );
      return undefined;
    }
  }

  public abstract next(): Result | undefined;

  *[Symbol.iterator](): Iterator<Result> {
    let result = this.next();
    while (result !== undefined) {
      yield result;
      result = this.next();
    }
  }
}

export class GroupBuffer extends ParserBase<
  Proto.GroupDetails,
  typeof Proto.GroupDetails,
  ModifiedGroupDetails
> {
  constructor(arrayBuffer: Uint8Array) {
    super(arrayBuffer, Proto.GroupDetails);
  }

  public override next(): ModifiedGroupDetails | undefined {
    const proto = this.decodeDelimited();
    if (!proto) {
      return undefined;
    }

    if (!proto.members) {
      return proto;
    }
    return {
      ...proto,
      members: proto.members.map((member, i) => {
        if (!member.uuid) {
          return member;
        }

        return {
          ...member,
          uuid: normalizeUuid(member.uuid, `GroupBuffer.member[${i}].uuid`),
        };
      }),
    };
  }
}

export class ContactBuffer extends ParserBase<
  Proto.ContactDetails,
  typeof Proto.ContactDetails,
  ModifiedContactDetails
> {
  constructor(arrayBuffer: Uint8Array) {
    super(arrayBuffer, Proto.ContactDetails);
  }

  public override next(): ModifiedContactDetails | undefined {
    const proto = this.decodeDelimited();
    if (!proto) {
      return undefined;
    }

    if (!proto.uuid) {
      return proto;
    }

    const { verified } = proto;

    return {
      ...proto,

      verified:
        verified && verified.destinationUuid
          ? {
              ...verified,

              destinationUuid: normalizeUuid(
                verified.destinationUuid,
                'ContactBuffer.verified.destinationUuid'
              ),
            }
          : verified,

      uuid: normalizeUuid(proto.uuid, 'ContactBuffer.uuid'),
    };
  }
}
