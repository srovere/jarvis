import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { Controller, Delete, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { BearerGuard } from './bearer.guard';
import { McpSessions } from './mcp-sessions';

/** MCP Streamable HTTP endpoint: hands the raw Node request/response to the session's transport. */
@Controller('mcp')
@UseGuards(BearerGuard)
export class McpController {
  constructor(private readonly sessions: McpSessions) {}

  @Post()
  async post(@Req() req: Request, @Res() res: Response): Promise<void> {
    const sessionId = req.header('mcp-session-id');
    if (sessionId === undefined && isInitializeRequest(req.body)) {
      const transport = await this.sessions.open();
      await transport.handleRequest(req, res, req.body);
      return;
    }
    await this.existing(req, res, req.body);
  }

  @Get()
  async get(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.existing(req, res);
  }

  @Delete()
  async delete(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.existing(req, res);
  }

  private async existing(req: Request, res: Response, body?: unknown): Promise<void> {
    const sessionId = req.header('mcp-session-id');
    if (sessionId === undefined) {
      res.status(400).json(rpcError(-32000, 'Bad Request: missing a valid mcp-session-id'));
      return;
    }
    const transport = this.sessions.get(sessionId);
    if (!transport) {
      res.status(404).json(rpcError(-32001, 'Session not found'));
      return;
    }
    await transport.handleRequest(req, res, body);
  }
}

function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}
