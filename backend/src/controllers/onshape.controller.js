import { onshapeService } from '../services/onshape.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { serialize } from '../utils/serialize.js';
import { env } from '../config/env.js';

export const onshapeController = {
  status: asyncHandler(async (req, res) => {
    res.json({ success: true, data: serialize(await onshapeService.status(req.user.id)) });
  }),

  authUrl: asyncHandler(async (req, res) => {
    res.json({ success: true, data: { url: onshapeService.authUrl(req.user.id) } });
  }),

  // Onshape 瀏覽器 redirect 進來（無 JWT header），完成後導回前端
  callback: asyncHandler(async (req, res) => {
    try {
      await onshapeService.handleCallback({ code: req.query.code, state: req.query.state });
      res.redirect(`${env.FRONTEND_URL}/?onshape=connected`);
    } catch (err) {
      console.error('[onshape callback]', err.message);
      res.redirect(`${env.FRONTEND_URL}/?onshape=error`);
    }
  }),

  disconnect: asyncHandler(async (req, res) => {
    res.json({ success: true, data: await onshapeService.disconnect(req.user.id) });
  }),

  resolve: asyncHandler(async (req, res) => {
    const result = await onshapeService.resolve(req.user.id, req.body.url);
    res.json({ success: true, data: serialize(result) });
  }),

  parts: asyncHandler(async (req, res) => {
    const result = await onshapeService.elementParts(req.user.id, req.validatedQuery);
    res.json({ success: true, data: serialize(result) });
  }),

  bom: asyncHandler(async (req, res) => {
    const result = await onshapeService.assemblyBom(req.user.id, req.validatedQuery);
    res.json({ success: true, data: serialize(result) });
  }),

  importPreview: asyncHandler(async (req, res) => {
    const result = await onshapeService.importPreview(req.user.id, req.body);
    res.json({ success: true, data: serialize(result) });
  }),

  importBom: asyncHandler(async (req, res) => {
    const result = await onshapeService.importBom(req.user.id, req.body);
    res.status(201).json({ success: true, data: serialize(result) });
  }),

  thumbnail: asyncHandler(async (req, res) => {
    const { buf, contentType } = await onshapeService.thumbnail(req.user.id, req.validatedQuery);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=300'); // 縮圖 5 分鐘快取
    res.send(buf);
  }),

  importItems: asyncHandler(async (req, res) => {
    const result = await onshapeService.listImportItems(req.validatedQuery);
    res.json({ success: true, data: serialize(result) });
  }),

  updateImportItem: asyncHandler(async (req, res) => {
    const result = await onshapeService.updateImportItem(req.params.id, req.body, req.user);
    res.json({ success: true, data: serialize(result) });
  }),

  partThumbnail: asyncHandler(async (req, res) => {
    const { buf, contentType } = await onshapeService.partThumbnail(req.user.id, req.validatedQuery);
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'private, max-age=600');
    res.send(buf);
  }),
};
