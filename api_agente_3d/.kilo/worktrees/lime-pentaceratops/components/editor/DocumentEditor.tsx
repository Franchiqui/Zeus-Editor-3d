'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  FileText,
  Save,
  Download,
  Undo,
  Redo,
  X,
  Minus,
  Square,
  Copy,
  Check,
  RefreshCw,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  Underline,
  List,
  Eye,
  Settings,
  FolderOpen,
  Loader2,
  Trash2,
  Calendar,
  Clock,
  Printer,
  FileCode,
  Search,
  Maximize,
  Minimize,
  Plus,
  Palette,
  ArrowUpDown,
  Globe,
  ExternalLink,
  Image as ImageIcon,
  Upload,
  Folder,
  Cloud,
  ChevronLeft
} from 'lucide-react';
import pb from '@/lib/pocketbase';
import { Modal } from '@/components/ui/modal';
import FileUploader from '@/components/ui/file-uploader';
import { cn, cleanDisplayFileName } from '@/lib/utils';
import { copyText } from '@/lib/clipboard';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAIEditorBridgeOptional } from '@/components/AIEditorBridgeContext';
import { useI18n } from '@/lib/i18n';
import { useLocalFonts } from '@/lib/useLocalFonts';
import { EditorFileNameBar } from '@/components/ui/EditorFileNameBar';
import { getLocalPaths, listDirectory, getMediaUrl, readProject, saveProject, writeFile, copyFile, ensureDir, getFilePath } from '@/lib/electron-fs';

type DocumentEditorProps = {
  documentUrl: string;
  fileName?: string;
  initialContent?: string;
  isLocalProject?: boolean;
  projectName?: string;
  projectPath?: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  onFormatChange?: (format: string) => void;
};

const TEMPLATES: { id: string; label: string; html: string }[] = [
  {
    id: 'carta',
    label: 'tplCarta',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:#ffffff; display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08); border:1px solid rgba(0,0,0,0.06); padding:30px 35px 25px 35px; position:relative;"><div style="position:absolute; left:20px; top:20px; right:20px; bottom:20px; border:2px solid #c9a227; border-radius:10px; pointer-events:none;"></div><div style="position:absolute; left:22px; top:22px; right:22px; height:8px; background:#1e3a5f; border-radius:6px 6px 0 0;"></div><div style="position:absolute; left:22px; bottom:22px; right:22px; height:8px; background:#1e3a5f; border-radius:0 0 6px 6px;"></div><div style="position:absolute; left:60px; top:55px; width:50px; height:50px; border-radius:50%; background:#1e3a5f; color:#ffffff; font-size:24px; line-height:50px; text-align:center; box-shadow:0 4px 12px rgba(30,58,95,0.3);">✉</div><div style="position:absolute; left:170px; top:50px; right:170px; height:50px; text-align:center; font-family:\'Georgia\', serif; font-size:34px; font-weight:bold; letter-spacing:5px; color:#1e3a5f;">CARTA FORMAL</div><div style="position:absolute; left:170px; top:95px; right:170px; height:26px; text-align:center; font-family:\'Georgia\', serif; font-size:16px; font-weight:bold; letter-spacing:8px; color:#b8860b;">DE SOLICITUD</div><div style="position:absolute; left:50%; top:132px; width:200px; height:2px; background:linear-gradient(90deg, #c9a227, #b8860b); transform:translateX(-50%);"></div><div style="position:absolute; left:50%; top:129px; width:8px; height:8px; background:#c9a227; transform:translateX(-50%) rotate(45deg);"></div><div style="position:absolute; left:70px; top:170px; width:300px; font-size:14px; font-weight:bold; color:#1e3a5f; text-transform:uppercase;">Remite:</div><div style="position:absolute; left:70px; top:192px; width:300px; font-size:13px; line-height:1.7; color:#3a3a3a;">Ana García López<br>Calle Mayor 15, 3.º B<br>28001 Madrid<br>Teléfono: 612 345 678<br>ana.garcia@email.com</div><div style="position:absolute; right:70px; top:170px; width:300px; font-size:14px; font-weight:bold; color:#1e3a5f; text-transform:uppercase; text-align:right;">Destinatario:</div><div style="position:absolute; right:70px; top:192px; width:300px; font-size:13px; line-height:1.7; color:#3a3a3a; text-align:right;">Departamento de Atención al Cliente<br>Empresa XYZ S.L.<br>Av. de la Constitución 42<br>28901 Getafe (Madrid)</div><div style="position:absolute; left:70px; top:332px; right:70px; height:1px; background:linear-gradient(90deg, transparent, #c9a227, #1e3a5f, #c9a227, transparent);"></div><div style="position:absolute; left:50%; top:326px; width:14px; height:14px; border-radius:50%; background:#1e3a5f; border:2px solid #c9a227; transform:translateX(-50%);"></div><div style="position:absolute; right:70px; top:352px; width:200px; height:20px; text-align:right; font-size:12px; color:#666;">Madrid, 24 de febrero de 2025</div><div style="position:absolute; left:70px; top:390px; right:70px; height:52px; background:#f4f6fa; border-left:6px solid #b8860b; border-radius:0 8px 8px 0; text-align:center; line-height:52px; font-size:16px; font-weight:bold; color:#1e3a5f;">Asunto: Solicitud de información sobre el servicio Premium</div><div style="position:absolute; left:70px; top:460px; right:70px; height:30px; font-family:\'Georgia\', serif; font-size:15px; font-style:italic; color:#333;">Estimado/a Sr./Sra.:</div><div style="position:absolute; left:70px; top:500px; width:4px; height:200px; background:linear-gradient(180deg, #1e3a5f, #c9a227); border-radius:2px;"></div><div style="position:absolute; left:90px; top:500px; right:90px; font-family:\'Georgia\', serif; font-size:14px; line-height:1.9; text-align:justify; color:#444;">Me dirijo a usted para interesarme por las condiciones del servicio Premium que su empresa ofrece actualmente. En concreto, me gustaría conocer las tarifas, plazos de entrega y opciones de personalización disponibles para clientes particulares.<br><br>Quedo a su disposición para ampliar cualquier información y agradezco de antemano la atención prestada.</div><div style="position:absolute; left:90px; top:740px; width:300px; font-family:\'Segoe UI\', sans-serif; font-size:14px; color:#333;">Saludos cordiales,</div><div style="position:absolute; left:90px; top:790px; width:260px; height:1px; background:#1e3a5f;"></div><div style="position:absolute; left:90px; top:800px; width:300px; font-family:\'Segoe UI\', sans-serif; font-size:22px; font-weight:bold; color:#1e3a5f;">Ana García López</div><div style="position:absolute; left:90px; top:840px; width:300px; font-size:12px; color:#888;">Remitente / Particular</div><div style="position:absolute; right:70px; top:750px; width:110px; height:110px; border-radius:50%; border:3px solid rgba(185,134,11,0.4); text-align:center; line-height:110px; font-size:11px; font-weight:bold; color:#b8860b; letter-spacing:1px; transform:rotate(-15deg); white-space:nowrap; overflow:hidden;">CON CARÁCTER URGENTE</div><div style="position:absolute; left:70px; bottom:48px; right:70px; text-align:center; font-size:10px; color:#aaa; letter-spacing:1px;">DOCUMENTO DE MUESTRA · PLANTILLA DE CARTA FORMAL</div></div></div>'
  },
  {
    id: 'carta-clasica',
    label: 'tplCartaClasica',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:#f0ede8; display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#fefcf7; box-shadow:0 20px 60px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.05); padding:50px 55px 40px 55px; position:relative; border:1px solid #e8e0d0;"><div style="position:absolute; top:0; left:0; right:0; height:4px; background:linear-gradient(90deg, #8B0000, #CD853F, #8B0000);"></div><div style="position:absolute; bottom:30px; right:40px; width:80px; height:80px; border-radius:50%; border:2px solid rgba(139,0,0,0.15); display:flex; align-items:center; justify-content:center; font-size:10px; color:#8B0000; text-transform:uppercase; letter-spacing:2px; transform:rotate(-20deg); opacity:0.5;">CONFIDENCIAL</div><div style="display:flex; justify-content:space-between; margin-bottom:30px; padding-bottom:20px; border-bottom:2px solid #e8e0d0;"><div><div style="font-size:11px; color:#8B0000; text-transform:uppercase; letter-spacing:3px; font-weight:600;">Remitente</div><div style="font-size:14px; color:#333; margin-top:4px; line-height:1.6;">Ana García López<br>Calle Mayor 15, 3.º B<br>28001 Madrid</div></div><div style="text-align:right;"><div style="font-size:11px; color:#8B0000; text-transform:uppercase; letter-spacing:3px; font-weight:600;">Destinatario</div><div style="font-size:14px; color:#333; margin-top:4px; line-height:1.6;">Departamento de Atención al Cliente<br>Empresa XYZ S.L.<br>Av. de la Constitución 42<br>28901 Getafe (Madrid)</div></div></div><div style="text-align:right; font-size:13px; color:#888; margin-bottom:20px;">Madrid, 24 de febrero de 2025</div><div style="background:#f8f6f0; padding:12px 18px; border-radius:4px; border-left:4px solid #8B0000; margin-bottom:22px;"><span style="font-weight:600; color:#8B0000;">Asunto:</span> Solicitud de información sobre el servicio Premium</div><div style="font-size:14px; color:#333; line-height:1.8; margin-bottom:22px;"><p style="margin-bottom:10px;">Estimado/a Sr./Sra.:</p><p style="text-align:justify; margin-bottom:10px;">Me dirijo a usted para interesarme por las condiciones del servicio Premium que su empresa ofrece actualmente. En concreto, me gustaría conocer las tarifas, plazos de entrega y opciones de personalización disponibles para clientes particulares.</p><p style="text-align:justify;">Quedo a su disposición para ampliar cualquier información y agradezco de antemano la atención prestada.</p></div><div style="margin-top:25px;"><p style="font-size:14px; color:#333;">Saludos cordiales,</p><div style="margin-top:20px;"><div style="width:200px; height:2px; background:#8B0000; margin-bottom:6px;"></div><div style="font-size:18px; font-weight:700; color:#8B0000; font-family:\'Georgia\', serif;">Ana García López</div><div style="font-size:12px; color:#888;">Remitente / Particular</div><div style="display:flex; gap:15px; margin-top:6px; font-size:11px; color:#aaa;"><span>📞 612 345 678</span><span>✉ ana.garcia@email.com</span></div></div></div><div style="border-top:1px solid #e8e0d0; margin-top:25px; padding-top:12px; display:flex; justify-content:space-between; font-size:10px; color:#ccc; text-transform:uppercase; letter-spacing:1px;"><span>Documento de muestra · Carta formal</span><span>Ref: C-2025-0024</span></div></div></div>'
  },
  {
    id: 'informe',
    label: 'tplInforme',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:#ffffff; display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08); border:1px solid rgba(0,0,0,0.06); padding:20px; box-sizing:border-box; position:relative;"><div style="position:absolute; left:20px; top:0; right:20px; height:10px; background:linear-gradient(90deg, rgb(30, 58, 138), rgb(59, 130, 246)); border-radius:16px 16px 0 0;"></div><div style="position:absolute; left:20px; bottom:0; right:20px; height:10px; background:linear-gradient(90deg, rgb(30, 58, 138), rgb(59, 130, 246)); border-radius:0 0 16px 16px;"></div><div style="position:absolute; left:40px; top:28px; width:8px; height:52px; background-color: rgba(37, 99, 235, 1); border-radius:4px;"></div><div style="position:absolute; left:60px; top:20px; right:60px; height:60px; font-family: Georgia, \'Times New Roman\', serif; font-size:52px; font-weight:700; color: rgb(30, 58, 138); text-align:center;">Informe</div><div style="position:absolute; left:64px; top:95px; width:180px; height:5px; background-color: rgba(59, 130, 246, 1); border-radius:3px;"></div><div style="position:absolute; right:60px; top:45px; width:280px; height:30px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:15px; font-style:italic; color: rgb(148, 163, 184); text-align:center;">Documento de trabajo</div><div style="position:absolute; left:40px; top:160px; width:calc(33.33% - 14px); height:110px; background-color: rgba(248, 250, 252, 1); border:1px solid #e2e8f0; border-radius:8px;"></div><div style="position:absolute; left:60px; top:178px; width:200px; height:20px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:12px; font-weight:700; color: rgb(59, 130, 246); text-align:center;">FECHA</div><div style="position:absolute; left:60px; top:206px; width:calc(33.33% - 54px); height:30px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:18px; font-weight:600; color: rgb(15, 23, 42); text-align:center;">[DD/MM/AAAA]</div><div style="position:absolute; left:calc(33.33% + 26px); top:160px; width:calc(33.33% - 14px); height:110px; background-color: rgba(248, 250, 252, 1); border:1px solid #e2e8f0; border-radius:8px;"></div><div style="position:absolute; left:calc(33.33% + 46px); top:178px; width:200px; height:20px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:12px; font-weight:700; color: rgb(16, 185, 129); text-align:center;">AUTOR</div><div style="position:absolute; left:calc(33.33% + 46px); top:206px; width:calc(33.33% - 54px); height:30px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:18px; font-weight:600; color: rgb(15, 23, 42); text-align:center;">[Nombre del autor]</div><div style="position:absolute; right:40px; top:160px; width:calc(33.33% - 14px); height:110px; background-color: rgba(248, 250, 252, 1); border:1px solid #e2e8f0; border-radius:8px;"></div><div style="position:absolute; right:60px; top:178px; width:200px; height:20px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:12px; font-weight:700; color: rgb(245, 158, 11); text-align:center;">DESTINATARIO</div><div style="position:absolute; right:60px; top:206px; width:calc(33.33% - 54px); height:30px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:18px; font-weight:600; color: rgb(15, 23, 42); text-align:center;">[Nombre del destinatario]</div><div style="position:absolute; left:40px; top:320px; width:calc(50% - 10px); height:36px; font-family: Georgia, \'Times New Roman\', serif; font-size:28px; font-weight:700; color: rgb(30, 58, 138); text-align:center;">Resumen ejecutivo</div><div style="position:absolute; left:40px; top:366px; width:90px; height:4px; background-color: rgba(59, 130, 246, 1); border-radius:2px;"></div><div style="position:absolute; left:40px; top:390px; right:40px; height:110px; background-color: rgba(248, 250, 252, 1); border-radius:0;"></div><div style="position:absolute; left:70px; top:412px; right:70px; height:80px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:16px; color: rgb(51, 65, 85); text-align:center;">Breve síntesis de los hallazgos o conclusiones.</div><div style="position:absolute; left:40px; top:530px; width:calc(50% - 10px); height:36px; font-family: Georgia, \'Times New Roman\', serif; font-size:28px; font-weight:700; color: rgb(30, 58, 138); text-align:center;">Introducción</div><div style="position:absolute; left:40px; top:576px; width:90px; height:4px; background-color: rgba(59, 130, 246, 1); border-radius:2px;"></div><div style="position:absolute; left:40px; top:600px; right:40px; height:110px; background-color: rgba(248, 250, 252, 1); border-radius:0;"></div><div style="position:absolute; left:70px; top:622px; right:70px; height:80px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:16px; color: rgb(51, 65, 85); text-align:center;">Contexto y objetivos del informe.</div><div style="position:absolute; left:40px; top:740px; width:calc(50% - 10px); height:36px; font-family: Georgia, \'Times New Roman\', serif; font-size:28px; font-weight:700; color: rgb(30, 58, 138); text-align:center;">Desarrollo</div><div style="position:absolute; left:40px; top:786px; width:90px; height:4px; background-color: rgba(59, 130, 246, 1); border-radius:2px;"></div><div style="position:absolute; left:40px; top:810px; right:40px; height:120px; background-color: rgba(248, 250, 252, 1); border-radius:0;"></div><div style="position:absolute; left:70px; top:832px; right:70px; height:90px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:16px; color: rgb(51, 65, 85); text-align:center;">Análisis detallado, datos y resultados.</div><div style="position:absolute; left:40px; top:960px; width:calc(50% - 10px); height:36px; font-family: Georgia, \'Times New Roman\', serif; font-size:28px; font-weight:700; color: rgb(30, 58, 138); text-align:center;">Conclusiones</div><div style="position:absolute; left:40px; top:1006px; width:90px; height:4px; background-color: rgba(59, 130, 246, 1); border-radius:2px;"></div><div style="position:absolute; left:40px; top:1030px; right:40px; height:50px; background-color: rgba(248, 250, 252, 1); border-radius:0;"></div><div style="position:absolute; left:70px; top:1042px; right:70px; height:36px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:16px; color: rgb(51, 65, 85); text-align:center;">Resumen de conclusiones y recomendaciones.</div></div></div>'
  },
  {
    id: 'informe-ejecutivo',
    label: 'tplInformeEjecutivo',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:#eef1f5; display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:8px; box-shadow:0 20px 60px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.06); overflow:hidden;"><div style="background:linear-gradient(135deg, #1a3a5c, #2c5282); padding:28px 40px; color:#ffffff; display:flex; justify-content:space-between; align-items:center;"><div><div style="font-size:11px; text-transform:uppercase; letter-spacing:4px; opacity:0.7;">Documento de trabajo</div><div style="font-size:36px; font-weight:700; font-family:\'Georgia\', serif; letter-spacing:-0.5px;">Informe Ejecutivo</div></div><div style="text-align:right;"><div style="font-size:12px; opacity:0.8;">📅 [DD/MM/AAAA]</div><div style="font-size:12px; opacity:0.6; margin-top:2px;">Versión 1.0</div></div></div><div style="padding:30px 40px 35px 40px;"><div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:28px;"><div style="background:#f7f9fc; padding:14px 16px; border-radius:6px; text-align:center; border:1px solid #e8ecf1;"><div style="font-size:10px; color:#2c5282; text-transform:uppercase; font-weight:700; letter-spacing:1px;">Fecha</div><div style="font-size:16px; font-weight:600; color:#1a3a5c; margin-top:2px;">[DD/MM/AAAA]</div></div><div style="background:#f7f9fc; padding:14px 16px; border-radius:6px; text-align:center; border:1px solid #e8ecf1;"><div style="font-size:10px; color:#2c5282; text-transform:uppercase; font-weight:700; letter-spacing:1px;">Autor</div><div style="font-size:16px; font-weight:600; color:#1a3a5c; margin-top:2px;">[Nombre del autor]</div></div><div style="background:#f7f9fc; padding:14px 16px; border-radius:6px; text-align:center; border:1px solid #e8ecf1;"><div style="font-size:10px; color:#2c5282; text-transform:uppercase; font-weight:700; letter-spacing:1px;">Destinatario</div><div style="font-size:16px; font-weight:600; color:#1a3a5c; margin-top:2px;">[Nombre del destinatario]</div></div></div><div style="margin-bottom:22px;"><div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;"><div style="width:4px; height:24px; background:#2c5282; border-radius:2px;"></div><div style="font-size:18px; font-weight:700; color:#1a3a5c; font-family:\'Georgia\', serif;">Resumen ejecutivo</div></div><div style="background:#f7f9fc; padding:16px 20px; border-radius:6px; border:1px solid #e8ecf1;"><p style="font-size:14px; color:#444; line-height:1.6; text-align:center;">Breve síntesis de los hallazgos o conclusiones.</p></div></div><div style="margin-bottom:22px;"><div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;"><div style="width:4px; height:24px; background:#2c5282; border-radius:2px;"></div><div style="font-size:18px; font-weight:700; color:#1a3a5c; font-family:\'Georgia\', serif;">Introducción</div></div><div style="background:#f7f9fc; padding:16px 20px; border-radius:6px; border:1px solid #e8ecf1;"><p style="font-size:14px; color:#444; line-height:1.6; text-align:center;">Contexto y objetivos del informe.</p></div></div><div style="margin-bottom:22px;"><div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;"><div style="width:4px; height:24px; background:#2c5282; border-radius:2px;"></div><div style="font-size:18px; font-weight:700; color:#1a3a5c; font-family:\'Georgia\', serif;">Desarrollo</div></div><div style="background:#f7f9fc; padding:16px 20px; border-radius:6px; border:1px solid #e8ecf1;"><p style="font-size:14px; color:#444; line-height:1.6; text-align:center;">Análisis detallado, datos y resultados.</p></div></div><div><div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;"><div style="width:4px; height:24px; background:#2c5282; border-radius:2px;"></div><div style="font-size:18px; font-weight:700; color:#1a3a5c; font-family:\'Georgia\', serif;">Conclusiones</div></div><div style="background:#f7f9fc; padding:16px 20px; border-radius:6px; border:1px solid #e8ecf1;"><p style="font-size:14px; color:#444; line-height:1.6; text-align:center;">Resumen de conclusiones y recomendaciones.</p></div></div><div style="border-top:1px solid #e8ecf1; margin-top:25px; padding-top:14px; display:flex; justify-content:space-between; font-size:10px; color:#aaa; text-transform:uppercase; letter-spacing:1px;"><span>Documento de trabajo · Informe ejecutivo</span><span>Confidencial</span></div></div></div></div>'
  },
  {
    id: 'curriculum',
    label: 'tplCurriculum',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:#ffffff; display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:8px; box-shadow:0 20px 60px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08); border:1px solid rgba(0,0,0,0.06); padding:0; box-sizing:border-box; position:relative; padding-bottom:30px;"><div style="position:absolute; left:0; top:0; right:0; height:200px; background-color: rgba(30, 58, 138, 1); border-radius:8px 8px 0 0;"></div><div style="position:absolute; left:50px; top:50px; right:50px; height:50px; font-family: Georgia, \'Times New Roman\', serif; font-size:36px; font-weight:700; color: rgb(255, 255, 255); text-align:center; white-space:nowrap;">María López Sánchez</div><div style="position:absolute; left:50px; top:110px; right:50px; height:25px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:16px; color: rgb(191, 219, 254); text-align:center; white-space:nowrap;">Diseñadora gráfica</div><div style="position:absolute; left:50px; top:145px; right:50px; height:20px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:13px; color: rgb(226, 232, 240); text-align:center; white-space:nowrap;">612 345 678 · maria.lopez@email.com · Madrid</div><div style="position:absolute; left:30px; top:220px; right:30px; height:2px; background-color: rgba(96, 165, 250, 1);"></div><div style="position:absolute; left:30px; top:250px; width:200px; height:25px; font-family: Georgia, \'Times New Roman\', serif; font-size:20px; font-weight:700; color: rgb(30, 58, 138); white-space:nowrap;">Perfil profesional</div><div style="position:absolute; left:30px; top:280px; width:80px; height:3px; background-color: rgba(59, 130, 246, 1);"></div><div style="position:absolute; left:30px; top:300px; right:30px; height:60px; font-family:\'Segoe UI\', Arial, sans-serif; font-size:13px; color: rgb(51, 65, 85); line-height:1.5;">Diseñadora creativa con más de 5 años de experiencia en identidad visual, diseño editorial y dirección de arte.</div><div style="position:absolute; left:30px; top:390px; width:220px; height:25px; font-family: Georgia, \'Times New Roman\', serif; font-size:20px; font-weight:700; color: rgb(30, 58, 138); white-space:nowrap;">Experiencia laboral</div><div style="position:absolute; left:30px; top:420px; width:80px; height:3px; background-color: rgba(59, 130, 246, 1);"></div><div style="position:absolute; left:30px; top:440px; right:30px; height:140px; background-color: rgba(248, 250, 252, 1); padding:15px; box-sizing:border-box; border-radius:4px;"><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:11px; font-weight:700; color: rgb(59, 130, 246); margin-bottom:5px; white-space:nowrap;">2022 - ACTUALIDAD · ESTUDIO ALPHA</div><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:15px; font-weight:700; color: rgb(15, 23, 42); margin-bottom:5px; white-space:nowrap;">Diseñadora senior</div><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:12px; color: rgb(51, 65, 85); line-height:1.4;">Liderazgo de proyectos de branding, diseño de packaging y campañas digitales.</div></div><div style="position:absolute; left:30px; top:610px; right:30px; height:120px; background-color: rgba(248, 250, 252, 1); padding:15px; box-sizing:border-box; border-radius:4px;"><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:11px; font-weight:700; color: rgb(59, 130, 246); margin-bottom:5px; white-space:nowrap;">2019 - 2022 · AGENCIA BETA</div><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:15px; font-weight:700; color: rgb(15, 23, 42); margin-bottom:5px; white-space:nowrap;">Diseñadora junior</div><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:12px; color: rgb(51, 65, 85); line-height:1.4;">Maquetación, ilustración publicitaria y gestión de redes sociales visuales.</div></div><div style="position:absolute; left:30px; top:760px; width:200px; height:25px; font-family: Georgia, \'Times New Roman\', serif; font-size:20px; font-weight:700; color: rgb(30, 58, 138); white-space:nowrap;">Formación</div><div style="position:absolute; left:30px; top:790px; width:80px; height:3px; background-color: rgba(59, 130, 246, 1);"></div><div style="position:absolute; left:30px; top:810px; right:30px; height:110px; background-color: rgba(248, 250, 252, 1); padding:15px; box-sizing:border-box; border-radius:4px;"><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:12px; font-weight:700; color: rgb(59, 130, 246); margin-bottom:5px; white-space:nowrap;">UNIVERSIDAD COMPLUTENSE (2019)</div><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:15px; font-weight:700; color: rgb(15, 23, 42); margin-bottom:5px; white-space:nowrap;">Grado en Diseño</div><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:12px; color: rgb(51, 65, 85); line-height:1.4;">Premio extraordinario de fin de grado.</div></div><div style="position:absolute; left:30px; top:950px; width:230px; height:25px; font-family: Georgia, \'Times New Roman\', serif; font-size:20px; font-weight:700; color: rgb(30, 58, 138); white-space:nowrap;">Idiomas y habilidades</div><div style="position:absolute; left:30px; top:980px; width:80px; height:3px; background-color: rgba(59, 130, 246, 1);"></div><div style="position:absolute; left:30px; top:1000px; right:30px; height:90px; background-color: rgba(248, 250, 252, 1); padding:15px; box-sizing:border-box; border-radius:4px;"><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:13px; color: rgb(51, 65, 85); margin-bottom:8px; white-space:nowrap;"><span style="font-weight:700; color: rgb(30, 58, 138);">Idiomas:</span> Español: nativo / Inglés: avanzado (C1)</div><div style="font-family:\'Segoe UI\', Arial, sans-serif; font-size:13px; color: rgb(51, 65, 85); white-space:nowrap;"><span style="font-weight:700; color: rgb(30, 58, 138);">Herramientas:</span> Figma, Adobe CC, Blender, HTML/CSS básico</div></div></div></div>'
  },
  {
    id: 'curriculum-moderno',
    label: 'tplCurriculumModerno',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:#f0f2f5; display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.08); display:flex; overflow:hidden; position:relative;"><div style="width:35%; background:linear-gradient(180deg, #1a1a2e, #16213e, #0f3460); padding:30px 20px 30px 25px; color:#ffffff; display:flex; flex-direction:column; gap:20px;"><div style="text-align:center; margin-bottom:10px;"><div style="width:100px; height:100px; border-radius:50%; background:linear-gradient(135deg, #e94560, #c23152); margin:0 auto 12px; display:flex; align-items:center; justify-content:center; font-size:42px; font-weight:700; color:#fff; border:3px solid rgba(255,255,255,0.3);">ML</div><div style="font-size:22px; font-weight:700; letter-spacing:1px;">María López</div><div style="font-size:13px; color:#e94560; font-weight:500; margin-top:2px;">Diseñadora Gráfica</div></div><div style="border-top:1px solid rgba(255,255,255,0.1); padding-top:15px;"><div style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#e94560; font-weight:600; margin-bottom:10px;">Contacto</div><div style="font-size:12px; line-height:2; color:#b0b0c0;"><div>📱 612 345 678</div><div>✉ maria.lopez@email.com</div><div>📍 Madrid, España</div></div></div><div style="border-top:1px solid rgba(255,255,255,0.1); padding-top:15px;"><div style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#e94560; font-weight:600; margin-bottom:10px;">Habilidades</div><div style="display:flex; flex-wrap:wrap; gap:5px;"><span style="background:rgba(233,69,96,0.2); color:#e94560; padding:4px 12px; border-radius:20px; font-size:11px;">Figma</span><span style="background:rgba(233,69,96,0.2); color:#e94560; padding:4px 12px; border-radius:20px; font-size:11px;">Adobe CC</span><span style="background:rgba(233,69,96,0.2); color:#e94560; padding:4px 12px; border-radius:20px; font-size:11px;">Blender</span><span style="background:rgba(233,69,96,0.2); color:#e94560; padding:4px 12px; border-radius:20px; font-size:11px;">HTML/CSS</span></div></div><div style="border-top:1px solid rgba(255,255,255,0.1); padding-top:15px; margin-top:auto;"><div style="font-size:11px; text-transform:uppercase; letter-spacing:2px; color:#e94560; font-weight:600; margin-bottom:10px;">Idiomas</div><div style="font-size:12px; line-height:2; color:#b0b0c0;">Español · Nativo<br>Inglés · Avanzado (C1)</div></div></div><div style="width:65%; padding:35px 30px 30px 30px; background:#ffffff;"><div style="margin-bottom:20px;"><div style="font-size:12px; text-transform:uppercase; letter-spacing:2px; color:#e94560; font-weight:600; border-bottom:2px solid #f0f0f0; padding-bottom:6px;">Perfil</div><p style="font-size:13px; color:#444; line-height:1.6; margin-top:10px;">Diseñadora creativa con más de 5 años de experiencia en identidad visual, diseño editorial y dirección de arte.</p></div><div style="margin-bottom:20px;"><div style="font-size:12px; text-transform:uppercase; letter-spacing:2px; color:#e94560; font-weight:600; border-bottom:2px solid #f0f0f0; padding-bottom:6px;">Experiencia</div><div style="margin-top:10px;"><div style="margin-bottom:12px;"><div style="display:flex; justify-content:space-between; font-size:13px;"><span style="font-weight:700; color:#1a1a2e;">Diseñadora Senior</span><span style="color:#888; font-size:11px;">2022 - Actualidad</span></div><div style="font-size:12px; color:#e94560; font-weight:500;">Estudio Alpha</div><p style="font-size:12px; color:#555; line-height:1.5; margin-top:3px;">Liderazgo de proyectos de branding, diseño de packaging y campañas digitales.</p></div><div><div style="display:flex; justify-content:space-between; font-size:13px;"><span style="font-weight:700; color:#1a1a2e;">Diseñadora Junior</span><span style="color:#888; font-size:11px;">2019 - 2022</span></div><div style="font-size:12px; color:#e94560; font-weight:500;">Agencia Beta</div><p style="font-size:12px; color:#555; line-height:1.5; margin-top:3px;">Maquetación, ilustración publicitaria y gestión de redes sociales visuales.</p></div></div></div><div><div style="font-size:12px; text-transform:uppercase; letter-spacing:2px; color:#e94560; font-weight:600; border-bottom:2px solid #f0f0f0; padding-bottom:6px;">Formación</div><div style="margin-top:10px;"><div style="display:flex; justify-content:space-between; font-size:13px;"><span style="font-weight:700; color:#1a1a2e;">Grado en Diseño</span><span style="color:#888; font-size:11px;">2019</span></div><div style="font-size:12px; color:#e94560; font-weight:500;">Universidad Complutense</div><p style="font-size:12px; color:#555; line-height:1.5; margin-top:3px;">Premio extraordinario de fin de grado.</p></div></div></div></div></div>'
  },
  {
    id: 'acta',
    label: 'tplActa',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:linear-gradient(135deg, #f0f4ff 0%, #e8edf5 100%); display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.06); padding:50px 55px 45px 55px; position:relative; border:1px solid rgba(255,255,255,0.3);"><div style="position:absolute; top:0; left:0; right:0; height:6px; background:linear-gradient(90deg, #1a3a8a, #4a7cf7, #1a3a8a); border-radius:16px 16px 0 0;"></div><div style="text-align:center; margin-bottom:35px; margin-top:5px;"><div style="font-size:11px; letter-spacing:4px; color:#4a7cf7; font-weight:600; text-transform:uppercase; margin-bottom:6px;">Consejo Directivo</div><div style="font-family: Georgia, \'Times New Roman\', serif; font-size:32px; font-weight:700; color:#0a1a3a; letter-spacing:-0.5px;">Acta de la Reunión</div><div style="width:60px; height:3px; background:linear-gradient(90deg, #4a7cf7, #1a3a8a); margin:10px auto 0;"></div></div><div style="display:flex; flex-wrap:wrap; gap:12px 30px; background:#f8faff; padding:18px 22px; border-radius:10px; margin-bottom:30px; border-left:4px solid #4a7cf7;"><div style="display:flex; align-items:center; gap:8px; font-size:14px;"><span style="font-weight:600; color:#1a3a8a; min-width:55px;">📅 Fecha:</span><span style="color:#2d3748;">28/07/2026</span></div><div style="display:flex; align-items:center; gap:8px; font-size:14px;"><span style="font-weight:600; color:#1a3a8a; min-width:55px;">📍 Lugar:</span><span style="color:#2d3748;">Sala de juntas principal</span></div><div style="display:flex; align-items:center; gap:8px; font-size:14px;"><span style="font-weight:600; color:#1a3a8a; min-width:55px;">🕐 Hora:</span><span style="color:#2d3748;">10:00</span></div></div><div style="margin-bottom:28px;"><div style="font-size:13px; font-weight:600; color:#1a3a8a; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Asistentes</div><div style="display:flex; flex-wrap:wrap; gap:8px;"><span style="background:#eef3ff; color:#1a3a8a; padding:6px 16px; border-radius:20px; font-size:14px; font-weight:500;">Laura Méndez</span><span style="background:#eef3ff; color:#1a3a8a; padding:6px 16px; border-radius:20px; font-size:14px; font-weight:500;">Carlos Ruiz</span><span style="background:#eef3ff; color:#1a3a8a; padding:6px 16px; border-radius:20px; font-size:14px; font-weight:500;">Ana Fernández</span><span style="background:#eef3ff; color:#1a3a8a; padding:6px 16px; border-radius:20px; font-size:14px; font-weight:500;">David Torres</span></div></div><div style="margin-bottom:28px;"><div style="font-size:13px; font-weight:600; color:#1a3a8a; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px;">Orden del día</div><div style="display:flex; flex-direction:column; gap:6px; padding-left:8px;"><div style="display:flex; align-items:center; gap:12px; font-size:14px; color:#2d3748;"><span style="display:inline-flex; align-items:center; justify-content:center; background:#4a7cf7; color:white; width:22px; height:22px; border-radius:50%; font-size:11px; font-weight:700; flex-shrink:0;">1</span>Aprobación del acta anterior</div><div style="display:flex; align-items:center; gap:12px; font-size:14px; color:#2d3748;"><span style="display:inline-flex; align-items:center; justify-content:center; background:#4a7cf7; color:white; width:22px; height:22px; border-radius:50%; font-size:11px; font-weight:700; flex-shrink:0;">2</span>Revisión del presupuesto de Q3</div><div style="display:flex; align-items:center; gap:12px; font-size:14px; color:#2d3748;"><span style="display:inline-flex; align-items:center; justify-content:center; background:#4a7cf7; color:white; width:22px; height:22px; border-radius:50%; font-size:11px; font-weight:700; flex-shrink:0;">3</span>Lanzamiento de la nueva web</div><div style="display:flex; align-items:center; gap:12px; font-size:14px; color:#2d3748;"><span style="display:inline-flex; align-items:center; justify-content:center; background:#4a7cf7; color:white; width:22px; height:22px; border-radius:50%; font-size:11px; font-weight:700; flex-shrink:0;">4</span>Ruegos y preguntas</div></div></div><div style="margin-bottom:28px;"><div style="font-size:13px; font-weight:600; color:#1a3a8a; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px;">Desarrollo</div><div style="background:#f8faff; padding:16px 20px; border-radius:10px; border-left:3px solid #4a7cf7;"><div style="display:flex; gap:16px; margin-bottom:10px; font-size:14px; color:#2d3748; line-height:1.6;"><span style="font-weight:700; color:#1a3a8a; min-width:28px;">1.</span><span>Se aprueba el acta anterior por unanimidad.</span></div><div style="display:flex; gap:16px; margin-bottom:10px; font-size:14px; color:#2d3748; line-height:1.6;"><span style="font-weight:700; color:#1a3a8a; min-width:28px;">2.</span><span>Se acuerda incrementar un 6% la inversión en formación interna.</span></div><div style="display:flex; gap:16px; font-size:14px; color:#2d3748; line-height:1.6;"><span style="font-weight:700; color:#1a3a8a; min-width:28px;">3.</span><span>El equipo de producto presentará la beta cerrada el 12 de agosto.</span></div></div></div><div style="margin-bottom:35px;"><div style="font-size:13px; font-weight:600; color:#1a3a8a; text-transform:uppercase; letter-spacing:1px; margin-bottom:10px;">Acuerdos</div><div style="background:linear-gradient(135deg, #f0f6ff, #e8efff); padding:16px 20px; border-radius:10px; border:1px solid rgba(74, 124, 247, 0.15);"><div style="display:flex; gap:12px; margin-bottom:8px; font-size:14px; color:#2d3748; line-height:1.5;"><span style="color:#4a7cf7; font-size:18px; line-height:1.2;">▸</span><span><strong style="color:#1a3a8a;">Encargo a Carlos Ruiz:</strong> actualización del presupuesto antes del 04/08/2026.</span></div><div style="display:flex; gap:12px; font-size:14px; color:#2d3748; line-height:1.5;"><span style="color:#4a7cf7; font-size:18px; line-height:1.2;">▸</span><span><strong style="color:#1a3a8a;">Grupo de seguimiento:</strong> se crea grupo para la nueva web con reunión semanal.</span></div></div></div><div style="border-top:2px dashed #dce3ef; padding-top:22px; display:flex; justify-content:space-between; align-items:flex-end; flex-wrap:wrap; gap:15px;"><div><div style="font-size:12px; color:#8896a8; text-transform:uppercase; letter-spacing:1px;">Secretario/a</div><div style="font-family: Georgia, \'Times New Roman\', serif; font-size:20px; font-weight:700; color:#1a3a8a; margin-top:2px;">Laura Méndez</div><div style="font-size:13px; color:#4a7cf7; font-weight:500;">Fdo.: Laura Méndez</div></div><div style="text-align:right;"><div style="font-size:11px; color:#8896a8; text-transform:uppercase; letter-spacing:0.5px;">Acta aprobada por unanimidad</div><div style="display:flex; gap:4px; justify-content:flex-end; margin-top:4px;"><span style="display:inline-block; width:30px; height:2px; background:#4a7cf7; opacity:0.3;"></span><span style="display:inline-block; width:30px; height:2px; background:#4a7cf7; opacity:0.6;"></span><span style="display:inline-block; width:30px; height:2px; background:#4a7cf7; opacity:1;"></span></div></div></div></div></div>'
  },
  {
    id: 'acta-corporativa',
    label: 'tplActaCorporativa',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:#e8ecf1; display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:4px; box-shadow:0 20px 60px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.06); padding:45px 50px 40px 50px; position:relative; border:1px solid #d0d5dd;"><div style="position:absolute; top:0; left:0; right:0; height:8px; background:linear-gradient(90deg, #2c3e50, #34495e, #2c3e50);"></div><div style="text-align:center; margin-bottom:30px; border-bottom:3px double #2c3e50; padding-bottom:20px;"><div style="font-size:14px; letter-spacing:6px; color:#7f8c8d; font-weight:600;">CONSEJO DIRECTIVO</div><div style="font-size:28px; font-weight:700; color:#2c3e50; font-family:\'Times New Roman\', serif; margin-top:5px;">ACTA DE REUNIÓN</div><div style="font-size:13px; color:#7f8c8d; margin-top:4px;">Nº 2026-07 · Sesión Ordinaria</div></div><div style="display:grid; grid-template-columns:1fr 1fr; gap:8px 30px; background:#f8f9fa; padding:14px 20px; border-radius:4px; margin-bottom:25px; border:1px solid #e9ecef;"><div style="font-size:13px;"><span style="font-weight:600; color:#2c3e50;">📅 Fecha:</span> 28 de julio de 2026</div><div style="font-size:13px;"><span style="font-weight:600; color:#2c3e50;">🕐 Hora:</span> 10:00 - 12:00</div><div style="font-size:13px;"><span style="font-weight:600; color:#2c3e50;">📍 Lugar:</span> Sala de juntas principal</div><div style="font-size:13px;"><span style="font-weight:600; color:#2c3e50;">📋 Acta anterior:</span> Aprobada</div></div><div style="margin-bottom:20px;"><div style="font-size:12px; font-weight:700; color:#2c3e50; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Asistentes</div><div style="display:flex; flex-wrap:wrap; gap:8px;"><span style="background:#e9ecef; padding:5px 14px; border-radius:4px; font-size:13px; color:#2c3e50;">Laura Méndez</span><span style="background:#e9ecef; padding:5px 14px; border-radius:4px; font-size:13px; color:#2c3e50;">Carlos Ruiz</span><span style="background:#e9ecef; padding:5px 14px; border-radius:4px; font-size:13px; color:#2c3e50;">Ana Fernández</span><span style="background:#e9ecef; padding:5px 14px; border-radius:4px; font-size:13px; color:#2c3e50;">David Torres</span></div></div><div style="margin-bottom:20px;"><div style="font-size:12px; font-weight:700; color:#2c3e50; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Orden del día</div><div style="background:#f8f9fa; padding:12px 16px; border-radius:4px; border-left:3px solid #2c3e50;"><div style="display:flex; gap:12px; font-size:13px; color:#333; padding:4px 0;"><span style="font-weight:700; color:#2c3e50; min-width:20px;">1.</span>Aprobación del acta anterior</div><div style="display:flex; gap:12px; font-size:13px; color:#333; padding:4px 0;"><span style="font-weight:700; color:#2c3e50; min-width:20px;">2.</span>Revisión del presupuesto de Q3</div><div style="display:flex; gap:12px; font-size:13px; color:#333; padding:4px 0;"><span style="font-weight:700; color:#2c3e50; min-width:20px;">3.</span>Lanzamiento de la nueva web</div><div style="display:flex; gap:12px; font-size:13px; color:#333; padding:4px 0;"><span style="font-weight:700; color:#2c3e50; min-width:20px;">4.</span>Ruegos y preguntas</div></div></div><div style="margin-bottom:20px;"><div style="font-size:12px; font-weight:700; color:#2c3e50; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Desarrollo</div><div style="background:#f8f9fa; padding:14px 18px; border-radius:4px;"><div style="display:flex; gap:12px; font-size:13px; color:#333; line-height:1.6; padding:3px 0;"><span style="font-weight:700; color:#2c3e50; min-width:20px;">1.</span>Se aprueba el acta anterior por unanimidad.</div><div style="display:flex; gap:12px; font-size:13px; color:#333; line-height:1.6; padding:3px 0;"><span style="font-weight:700; color:#2c3e50; min-width:20px;">2.</span>Se acuerda incrementar un 6% la inversión en formación interna.</div><div style="display:flex; gap:12px; font-size:13px; color:#333; line-height:1.6; padding:3px 0;"><span style="font-weight:700; color:#2c3e50; min-width:20px;">3.</span>El equipo de producto presentará la beta cerrada el 12 de agosto.</div></div></div><div style="margin-bottom:25px;"><div style="font-size:12px; font-weight:700; color:#2c3e50; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Acuerdos</div><div style="background:#eef2f7; padding:14px 18px; border-radius:4px; border:1px solid #d5dce6;"><div style="display:flex; gap:10px; font-size:13px; color:#333; line-height:1.5; padding:3px 0;"><span style="color:#2c3e50;">▸</span>Se encarga a Carlos Ruiz la actualización del presupuesto antes del 04/08/2026.</div><div style="display:flex; gap:10px; font-size:13px; color:#333; line-height:1.5; padding:3px 0;"><span style="color:#2c3e50;">▸</span>Se crea un grupo de seguimiento para la nueva web con reunión semanal.</div></div></div><div style="border-top:2px solid #2c3e50; padding-top:18px; display:flex; justify-content:space-between; align-items:center;"><div><div style="font-size:11px; color:#7f8c8d; text-transform:uppercase;">Secretario/a</div><div style="font-size:18px; font-weight:700; color:#2c3e50; font-family:\'Times New Roman\', serif;">Laura Méndez</div></div><div style="text-align:right;"><div style="font-size:11px; color:#7f8c8d;">Firmado digitalmente</div><div style="width:120px; height:40px; border:1px dashed #2c3e50; border-radius:4px; margin-top:4px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#7f8c8d;">SELLO OFICIAL</div></div></div></div></div>'
  },
  {
    id: 'nota-prensa',
    label: 'tplNotaPrensa',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:linear-gradient(135deg, #f5f7fa 0%, #e9edf5 100%); display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.06); padding:50px 55px 45px 55px; position:relative; border:1px solid rgba(255,255,255,0.3);"><div style="position:absolute; top:0; left:0; right:0; height:6px; background:linear-gradient(90deg, #c0392b, #e74c3c, #c0392b); border-radius:16px 16px 0 0;"></div><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:30px; margin-top:5px; border-bottom:2px solid #f0f2f5; padding-bottom:20px;"><div><div style="font-size:11px; letter-spacing:3px; color:#c0392b; font-weight:700; text-transform:uppercase;">Nota de prensa</div><div style="font-family: Georgia, \'Times New Roman\', serif; font-size:28px; font-weight:700; color:#1a1a2e; letter-spacing:-0.5px; margin-top:2px;">Comunicado oficial</div></div><div style="text-align:right;"><div style="font-size:11px; color:#7a8a9e; text-transform:uppercase; letter-spacing:0.5px;">Para publicación inmediata</div><div style="display:flex; gap:4px; justify-content:flex-end; margin-top:4px;"><span style="display:inline-block; width:25px; height:2px; background:#c0392b; opacity:0.3;"></span><span style="display:inline-block; width:25px; height:2px; background:#c0392b; opacity:0.6;"></span><span style="display:inline-block; width:25px; height:2px; background:#c0392b; opacity:1;"></span></div></div></div><div style="background:#f8f9fc; padding:14px 20px; border-radius:8px; margin-bottom:28px; display:flex; flex-wrap:wrap; gap:10px 30px; border-left:4px solid #c0392b;"><div style="display:flex; align-items:center; gap:8px; font-size:13px; color:#2d3748;"><span style="font-weight:600; color:#c0392b; min-width:70px;">📅 Fecha:</span><span>29 de julio de 2026</span></div><div style="display:flex; align-items:center; gap:8px; font-size:13px; color:#2d3748;"><span style="font-weight:600; color:#c0392b; min-width:70px;">📱 Contacto:</span><span>David Torres · 612 000 111 · comunicacion@empresa.com</span></div></div><div style="margin-bottom:25px;"><div style="font-family: Georgia, \'Times New Roman\', serif; font-size:26px; font-weight:700; color:#1a1a2e; line-height:1.3; margin-bottom:12px; letter-spacing:-0.3px;">Nueva app de productividad con IA llega a España</div><div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;"><span style="display:inline-block; width:40px; height:3px; background:linear-gradient(90deg, #c0392b, #e74c3c);"></span><span style="font-size:13px; color:#7a8a9e; font-weight:500;">Madrid, 29 de julio de 2026</span></div><div style="font-size:15px; color:#2d3748; line-height:1.7; background:#fafbfc; padding:16px 20px; border-radius:8px; border:1px solid #eef0f4;">La startup <strong style="color:#c0392b;">Zeus Media Studio</strong> lanza una app de productividad con IA que ayuda a crear documentos, vídeos y planes de contenido en minutos.</div></div><div style="margin-bottom:25px;"><div style="font-size:12px; font-weight:700; color:#c0392b; text-transform:uppercase; letter-spacing:2px; margin-bottom:10px;">▸ Desarrollo</div><div style="padding-left:16px; border-left:3px solid #e74c3c; font-size:14px; color:#2d3748; line-height:1.7;">La aplicación, disponible para escritorio y móvil, incluye asistentes de redacción, plantillas inteligentes y exportación directa. Según <strong>David Torres</strong>, CEO, la herramienta ya tiene más de 1.200 usuarios en beta cerrada.</div></div><div style="margin-bottom:30px;"><div style="font-size:12px; font-weight:700; color:#c0392b; text-transform:uppercase; letter-spacing:2px; margin-bottom:10px;">▸ Boletín de la organización</div><div style="background:linear-gradient(135deg, #fdf2f0, #fae9e7); padding:16px 20px; border-radius:8px; border:1px solid rgba(192, 57, 43, 0.12);"><div style="font-size:14px; color:#2d3748; line-height:1.6;"><strong style="color:#c0392b;">Zeus Media Studio</strong> es una empresa tecnológica con sede en Madrid especializada en herramientas creativas para profesionales y pymes.</div></div></div><div style="border-top:2px solid #f0f2f5; padding-top:22px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;"><div><div style="font-size:11px; color:#7a8a9e; text-transform:uppercase; letter-spacing:1px;">Para más información</div><div style="font-size:13px; color:#1a1a2e; margin-top:2px;"><span style="font-weight:600;">David Torres</span> · 612 000 111 · comunicacion@empresa.com</div></div><div style="text-align:right;"><div style="font-size:10px; color:#7a8a9e; text-transform:uppercase; letter-spacing:1px;">Nota de prensa · 29/07/2026</div><div style="display:flex; gap:4px; justify-content:flex-end; margin-top:4px;"><span style="display:inline-block; width:30px; height:2px; background:#c0392b; opacity:0.2;"></span><span style="display:inline-block; width:30px; height:2px; background:#c0392b; opacity:0.5;"></span><span style="display:inline-block; width:30px; height:2px; background:#c0392b; opacity:1;"></span></div></div></div></div></div>'
  },
  {
    id: 'nota-prensa-ejecutiva',
    label: 'tplNotaPrensaEjecutiva',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:#f5f5f5; display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; box-shadow:0 20px 60px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.05); padding:50px 55px 40px 55px; position:relative;"><div style="position:absolute; top:0; left:0; right:0; height:5px; background:#1a1a2e;"></div><div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:25px; border-bottom:1px solid #e8e8e8; padding-bottom:15px;"><div><div style="font-size:12px; color:#e94560; font-weight:700; letter-spacing:3px; text-transform:uppercase;">Nota de prensa</div><div style="font-size:11px; color:#888;">Para publicación inmediata</div></div><div style="text-align:right;"><div style="font-size:11px; color:#888;">29 de julio de 2026</div><div style="font-size:11px; color:#e94560;">Referencia: NP-2026-07-29</div></div></div><div style="margin-bottom:20px;"><div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px;">Contacto de prensa</div><div style="font-size:14px; color:#1a1a2e; font-weight:500;">David Torres · 612 000 111 · comunicacion@empresa.com</div></div><div style="margin-bottom:25px;"><div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Comunicado</div><div style="font-size:24px; font-weight:700; color:#1a1a2e; font-family:\'Georgia\', serif; line-height:1.2;">Nueva app de productividad con IA llega a España</div></div><div style="background:#fafafa; padding:16px 20px; border-left:4px solid #e94560; margin-bottom:22px; font-size:14px; color:#333; line-height:1.6;"><span style="font-weight:600;">Madrid, 29 de julio de 2026</span> — La startup Zeus Media Studio lanza una app de productividad con IA que ayuda a crear documentos, vídeos y planes de contenido en minutos.</div><div style="margin-bottom:22px;"><div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Detalles</div><div style="font-size:14px; color:#333; line-height:1.7; padding-left:16px; border-left:2px solid #e94560;">La aplicación, disponible para escritorio y móvil, incluye asistentes de redacción, plantillas inteligentes y exportación directa. Según David Torres, CEO, la herramienta ya tiene más de 1.200 usuarios en beta cerrada.</div></div><div style="background:#fafafa; padding:16px 20px; border-radius:4px; margin-bottom:25px;"><div style="font-size:11px; color:#888; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">Sobre la organización</div><div style="font-size:14px; color:#333; line-height:1.6;"><span style="font-weight:600; color:#1a1a2e;">Zeus Media Studio</span> es una empresa tecnológica con sede en Madrid especializada en herramientas creativas para profesionales y pymes.</div></div><div style="border-top:1px solid #e8e8e8; padding-top:18px; display:flex; justify-content:space-between; align-items:center;"><div><div style="font-size:10px; color:#aaa; text-transform:uppercase; letter-spacing:1px;">Distribuido por</div><div style="font-size:12px; font-weight:500; color:#1a1a2e;">Departamento de Comunicación</div></div><div style="text-align:right;"><div style="font-size:10px; color:#aaa;">Nota de prensa · 29/07/2026</div><div style="display:flex; gap:4px; justify-content:flex-end; margin-top:3px;"><span style="display:inline-block; width:25px; height:2px; background:#1a1a2e;"></span><span style="display:inline-block; width:25px; height:2px; background:#1a1a2e; opacity:0.5;"></span><span style="display:inline-block; width:25px; height:2px; background:#1a1a2e; opacity:0.2;"></span></div></div></div></div></div>'
  },
  {
    id: 'propuesta',
    label: 'tplPropuesta',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:linear-gradient(135deg, #f0f4ff 0%, #e8edf5 100%); display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.06); padding:50px 55px 45px 55px; position:relative; border:1px solid rgba(255,255,255,0.3);"><div style="position:absolute; top:0; left:0; right:0; height:6px; background:linear-gradient(90deg, #2d3748, #4a5568, #2d3748); border-radius:16px 16px 0 0;"></div><div style="text-align:center; margin-bottom:35px; margin-top:5px;"><div style="font-size:11px; letter-spacing:4px; color:#4a5568; font-weight:600; text-transform:uppercase; margin-bottom:6px;">Studio Creativo Norte</div><div style="font-family: Georgia, \'Times New Roman\', serif; font-size:34px; font-weight:700; color:#1a202c; letter-spacing:-0.5px;">Propuesta de Rediseño Web</div><div style="width:80px; height:3px; background:linear-gradient(90deg, #4a5568, #2d3748); margin:10px auto 0;"></div></div><div style="background:#f8fafc; padding:18px 24px; border-radius:10px; margin-bottom:30px; border-left:4px solid #2d3748; display:flex; flex-wrap:wrap; justify-content:space-between; gap:10px 20px;"><div style="display:flex; align-items:center; gap:8px; font-size:14px; color:#2d3748;"><span style="font-weight:600; color:#1a202c; min-width:50px;">Para:</span><span style="font-weight:500;">Clínica dental Sonrisa</span></div><div style="display:flex; align-items:center; gap:8px; font-size:14px; color:#2d3748;"><span style="font-weight:600; color:#1a202c; min-width:50px;">De:</span><span style="font-weight:500;">Studio Creativo Norte</span></div><div style="display:flex; align-items:center; gap:8px; font-size:14px; color:#2d3748;"><span style="font-weight:600; color:#1a202c; min-width:50px;">Fecha:</span><span style="font-weight:500;">30 de julio de 2026</span></div></div><div style="margin-bottom:28px;"><div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;"><span style="display:inline-flex; align-items:center; justify-content:center; background:#2d3748; color:white; width:32px; height:32px; border-radius:50%; font-size:14px; font-weight:700; flex-shrink:0;">1</span><div style="font-size:18px; font-weight:700; color:#1a202c; font-family: Georgia, \'Times New Roman\', serif;">Objetivo</div></div><div style="background:#f8fafc; padding:14px 20px; border-radius:8px; border-left:3px solid #4a5568; margin-left:44px; font-size:14px; color:#2d3748; line-height:1.6;">Renovar la identidad digital de la clínica para captar más pacientes locales y mejorar la experiencia de visita web en móvil.</div></div><div style="margin-bottom:28px;"><div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;"><span style="display:inline-flex; align-items:center; justify-content:center; background:#2d3748; color:white; width:32px; height:32px; border-radius:50%; font-size:14px; font-weight:700; flex-shrink:0;">2</span><div style="font-size:18px; font-weight:700; color:#1a202c; font-family: Georgia, \'Times New Roman\', serif;">Alcance</div></div><div style="background:#f8fafc; padding:14px 20px; border-radius:8px; border-left:3px solid #4a5568; margin-left:44px; font-size:14px; color:#2d3748; line-height:1.6;">Diseño de home y fichas de servicios, copy básico, integración con gestor de citas y entrega del prototipo navegable.</div></div><div style="margin-bottom:28px;"><div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;"><span style="display:inline-flex; align-items:center; justify-content:center; background:#2d3748; color:white; width:32px; height:32px; border-radius:50%; font-size:14px; font-weight:700; flex-shrink:0;">3</span><div style="font-size:18px; font-weight:700; color:#1a202c; font-family: Georgia, \'Times New Roman\', serif;">Presupuesto y plazos</div></div><div style="background:linear-gradient(135deg, #f0f4ff, #e8edf8); padding:16px 20px; border-radius:8px; border:1px solid rgba(45, 55, 72, 0.1); margin-left:44px;"><div style="display:flex; flex-wrap:wrap; justify-content:space-between; gap:10px 20px; font-size:14px; color:#2d3748;"><div><span style="font-weight:600; color:#1a202c;">💰 Inversión:</span> <span style="font-weight:700; color:#2d3748; font-size:16px;">2.800 €</span></div><div><span style="font-weight:600; color:#1a202c;">📅 Inicio:</span> 05 de agosto de 2026</div><div><span style="font-weight:600; color:#1a202c;">🚀 Entrega:</span> 02 de septiembre de 2026</div></div></div></div><div style="margin-bottom:30px;"><div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;"><span style="display:inline-flex; align-items:center; justify-content:center; background:#2d3748; color:white; width:32px; height:32px; border-radius:50%; font-size:14px; font-weight:700; flex-shrink:0;">4</span><div style="font-size:18px; font-weight:700; color:#1a202c; font-family: Georgia, \'Times New Roman\', serif;">Condiciones y aceptación</div></div><div style="background:linear-gradient(135deg, #fafbfc, #f0f2f5); padding:16px 20px; border-radius:8px; border:1px solid #e2e8f0; margin-left:44px; font-size:14px; color:#2d3748; line-height:1.7;"><div style="display:flex; gap:12px; margin-bottom:6px;"><span style="color:#4a5568; font-weight:700;">▸</span><span>Aceptación por correo electrónico</span></div><div style="display:flex; gap:12px; margin-bottom:6px;"><span style="color:#4a5568; font-weight:700;">▸</span><span>Pago 50% al inicio y 50% a la entrega</span></div><div style="display:flex; gap:12px;"><span style="color:#4a5568; font-weight:700;">▸</span><span>Incluye una ronda de cambios</span></div></div></div><div style="border-top:2px solid #e2e8f0; padding-top:22px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;"><div><div style="font-size:11px; color:#718096; text-transform:uppercase; letter-spacing:1px;">Studio Creativo Norte</div><div style="font-family: Georgia, \'Times New Roman\', serif; font-size:18px; font-weight:700; color:#1a202c; margin-top:2px;">Propuesta válida hasta 15/08/2026</div></div><div style="text-align:right;"><div style="display:flex; gap:12px; align-items:center; font-size:12px; color:#718096;"><span style="display:inline-block; width:50px; height:2px; background:#2d3748; opacity:0.3;"></span><span>Firma digital</span><span style="display:inline-block; width:50px; height:2px; background:#2d3748; opacity:0.3;"></span></div><div style="font-size:11px; color:#a0aec0; margin-top:2px;">Aceptación por correo electrónico</div></div></div></div></div>'
  },
  {
    id: 'propuesta-creativa',
    label: 'tplPropuestaCreativa',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:#f0f4ff; display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.06); overflow:hidden;"><div style="background:linear-gradient(135deg, #6C63FF, #5A52D5); padding:30px 40px; color:#ffffff;"><div style="font-size:12px; letter-spacing:4px; opacity:0.8; text-transform:uppercase;">Studio Creativo Norte</div><div style="font-size:32px; font-weight:700; margin-top:4px; font-family:\'Georgia\', serif;">Propuesta de Rediseño Web</div><div style="display:flex; gap:30px; margin-top:12px; font-size:14px; opacity:0.9;"><span>📅 30 de julio de 2026</span><span>📌 Clínica dental Sonrisa</span></div></div><div style="padding:30px 40px 35px 40px;"><div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-bottom:25px;"><div style="background:#f8f7ff; padding:16px 20px; border-radius:10px; border-left:4px solid #6C63FF;"><div style="font-size:11px; color:#6C63FF; text-transform:uppercase; font-weight:700; letter-spacing:1px;">Objetivo</div><div style="font-size:14px; color:#333; margin-top:4px; line-height:1.5;">Renovar la identidad digital de la clínica para captar más pacientes locales y mejorar la experiencia de visita web en móvil.</div></div><div style="background:#f8f7ff; padding:16px 20px; border-radius:10px; border-left:4px solid #6C63FF;"><div style="font-size:11px; color:#6C63FF; text-transform:uppercase; font-weight:700; letter-spacing:1px;">Alcance</div><div style="font-size:14px; color:#333; margin-top:4px; line-height:1.5;">Diseño de home y fichas de servicios, copy básico, integración con gestor de citas y entrega del prototipo navegable.</div></div></div><div style="background:linear-gradient(135deg, #f8f7ff, #f0eeff); padding:18px 22px; border-radius:10px; margin-bottom:25px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;"><div><div style="font-size:11px; color:#6C63FF; text-transform:uppercase; font-weight:700; letter-spacing:1px;">Presupuesto</div><div style="font-size:28px; font-weight:700; color:#1a1a2e;">2.800 €</div></div><div style="text-align:center;"><div style="font-size:11px; color:#888;">Inicio</div><div style="font-size:15px; font-weight:600; color:#1a1a2e;">05/08/2026</div></div><div style="text-align:center;"><div style="font-size:11px; color:#888;">Entrega</div><div style="font-size:15px; font-weight:600; color:#1a1a2e;">02/09/2026</div></div><div style="background:#6C63FF; color:#fff; padding:6px 18px; border-radius:20px; font-size:12px; font-weight:600;">✔ Incluye cambios</div></div><div style="background:#fafafa; padding:16px 20px; border-radius:10px; border:1px solid #e8e8e8;"><div style="font-size:11px; color:#6C63FF; text-transform:uppercase; font-weight:700; letter-spacing:1px; margin-bottom:6px;">Condiciones y aceptación</div><div style="display:flex; gap:20px; flex-wrap:wrap; font-size:13px; color:#333;"><span>📧 Aceptación por correo electrónico</span><span>💳 50% inicio · 50% entrega</span><span>🔄 Una ronda de cambios</span></div></div><div style="border-top:2px solid #f0f0f0; margin-top:22px; padding-top:18px; display:flex; justify-content:space-between; align-items:center;"><div><div style="font-size:11px; color:#888;">Firma digital</div><div style="font-size:14px; font-weight:600; color:#1a1a2e;">Studio Creativo Norte</div></div><div style="text-align:right; font-size:12px; color:#888;">Propuesta válida hasta 15/08/2026</div></div></div></div></div>'
  },
  {
    id: 'blog',
    label: 'tplBlog',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%); display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.05); padding:50px 55px 45px 55px; position:relative; border:1px solid rgba(255,255,255,0.3);"><div style="position:absolute; top:0; left:0; right:0; height:6px; background:linear-gradient(90deg, #f6ad55, #ed8936, #f6ad55); border-radius:16px 16px 0 0;"></div><div style="display:flex; align-items:center; gap:12px; margin-bottom:16px; margin-top:5px;"><span style="background:#f6ad55; color:#ffffff; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; padding:4px 14px; border-radius:20px;">Productividad</span><span style="font-size:13px; color:#a0aec0;">·</span><span style="font-size:13px; color:#718096;">29 de julio de 2026</span></div><div style="font-family: Georgia, \'Times New Roman\', serif; font-size:32px; font-weight:700; color:#1a202c; line-height:1.2; margin-bottom:8px; letter-spacing:-0.3px;">¿Cómo organizar una semana productiva sin quemarte?</div><div style="display:flex; align-items:center; gap:8px; margin-bottom:25px;"><span style="font-weight:600; color:#2d3748; font-size:15px;">Por Marta Ruiz</span><span style="color:#a0aec0;">·</span><span style="color:#718096; font-size:14px;">29/07/2026</span></div><div style="background:linear-gradient(135deg, #fefcbf, #fef3c7); padding:16px 22px; border-radius:10px; border-left:4px solid #ed8936; margin-bottom:30px; font-size:15px; color:#2d3748; line-height:1.7; font-style:italic;">Empezar el lunes con una lista interminable solo garantiza estrés. En este artículo encontrarás un método sencillo para priorizar, delegar y recuperar el control de tu tiempo.</div><div style="margin-bottom:28px;"><div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;"><span style="display:inline-flex; align-items:center; justify-content:center; background:#ed8936; color:white; width:32px; height:32px; border-radius:50%; font-size:14px; font-weight:700; flex-shrink:0;">1</span><div style="font-size:18px; font-weight:700; color:#1a202c; font-family: Georgia, \'Times New Roman\', serif;">Define solo 3 prioridades diarias</div></div><div style="padding-left:44px; font-size:14px; color:#2d3748; line-height:1.7;">Menos tareas importantes significa más foco. Escribe las 3 cosas que deben pasar sí o sí ese día y todo lo demás pasa a segundo plano.</div></div><div style="margin-bottom:30px;"><div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;"><span style="display:inline-flex; align-items:center; justify-content:center; background:#ed8936; color:white; width:32px; height:32px; border-radius:50%; font-size:14px; font-weight:700; flex-shrink:0;">2</span><div style="font-size:18px; font-weight:700; color:#1a202c; font-family: Georgia, \'Times New Roman\', serif;">Protege tus bloques profundos</div></div><div style="padding-left:44px; font-size:14px; color:#2d3748; line-height:1.7;">Reserva 90 minutos sin reuniones ni notificaciones. Úsalos para las tareas que requieren más concentración.</div></div><div style="background:linear-gradient(135deg, #edf2f7, #e2e8f0); padding:20px 24px; border-radius:10px; margin-bottom:10px;"><div style="font-size:13px; font-weight:700; color:#2d3748; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Conclusión</div><div style="font-size:15px; color:#1a202c; line-height:1.7; font-weight:500;">No necesitas hacer más, necesitas hacer lo que importa. Prueba este método durante 7 días y ajusta el sistema a tu ritmo.</div></div><div style="border-top:2px solid #e2e8f0; padding-top:22px; margin-top:5px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:15px;"><div><div style="font-size:11px; color:#a0aec0; text-transform:uppercase; letter-spacing:1px;">Comparte este artículo</div><div style="display:flex; gap:10px; margin-top:4px;"><span style="display:inline-block; background:#edf2f7; color:#2d3748; padding:4px 14px; border-radius:20px; font-size:12px;">Twitter</span><span style="display:inline-block; background:#edf2f7; color:#2d3748; padding:4px 14px; border-radius:20px; font-size:12px;">LinkedIn</span><span style="display:inline-block; background:#edf2f7; color:#2d3748; padding:4px 14px; border-radius:20px; font-size:12px;">WhatsApp</span></div></div><div style="text-align:right;"><div style="font-size:11px; color:#a0aec0; text-transform:uppercase; letter-spacing:0.5px;">Tiempo de lectura</div><div style="font-size:14px; font-weight:600; color:#2d3748;">3 min</div></div></div></div></div>'
  },
  {
    id: 'blog-minimalista',
    label: 'tplBlogMinimalista',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:#fafafa; display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; box-shadow:0 20px 60px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.04); padding:50px 55px 40px 55px;"><div style="text-align:center; margin-bottom:30px;"><div style="font-size:11px; color:#bbb; text-transform:uppercase; letter-spacing:3px;">Blog · Productividad</div><div style="font-family:\'Georgia\', serif; font-size:30px; font-weight:700; color:#1a1a2e; margin-top:6px; letter-spacing:-0.5px;">¿Cómo organizar una semana productiva sin quemarte?</div><div style="font-size:13px; color:#999; margin-top:8px;">Por Marta Ruiz · 29 de julio de 2026</div></div><div style="background:#f8f8f8; padding:18px 22px; border-radius:4px; margin-bottom:28px; font-size:15px; color:#444; line-height:1.7; font-style:italic; border-left:4px solid #ccc;">Empezar el lunes con una lista interminable solo garantiza estrés. En este artículo encontrarás un método sencillo para priorizar, delegar y recuperar el control de tu tiempo.</div><div style="margin-bottom:22px;"><div style="font-size:11px; color:#bbb; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">01.</div><div style="font-size:18px; font-weight:700; color:#1a1a2e; font-family:\'Georgia\', serif;">Define solo 3 prioridades diarias</div><p style="font-size:14px; color:#555; line-height:1.7; margin-top:6px;">Menos tareas importantes significa más foco. Escribe las 3 cosas que deben pasar sí o sí ese día y todo lo demás pasa a segundo plano.</p></div><div style="margin-bottom:25px;"><div style="font-size:11px; color:#bbb; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">02.</div><div style="font-size:18px; font-weight:700; color:#1a1a2e; font-family:\'Georgia\', serif;">Protege tus bloques profundos</div><p style="font-size:14px; color:#555; line-height:1.7; margin-top:6px;">Reserva 90 minutos sin reuniones ni notificaciones. Úsalos para las tareas que requieren más concentración.</p></div><div style="background:#f8f8f8; padding:18px 22px; border-radius:4px;"><div style="font-size:11px; color:#bbb; text-transform:uppercase; letter-spacing:2px; margin-bottom:4px;">Conclusión</div><div style="font-size:15px; color:#1a1a2e; font-weight:500; line-height:1.6;">No necesitas hacer más, necesitas hacer lo que importa. Prueba este método durante 7 días y ajusta el sistema a tu ritmo.</div></div><div style="border-top:1px solid #eee; margin-top:25px; padding-top:18px; display:flex; justify-content:space-between; align-items:center;"><div style="display:flex; gap:8px; font-size:12px; color:#999;"><span>Compartir:</span><span style="color:#666;">Twitter</span><span style="color:#666;">LinkedIn</span></div><div style="font-size:12px; color:#999;">⏱️ 3 min de lectura</div></div></div></div>'
  },
  {
    id: 'redes-sociales',
    label: 'tplRedesSociales',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%); display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:16px; box-shadow:0 20px 60px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.05); padding:50px 55px 45px 55px; position:relative; border:1px solid rgba(255,255,255,0.3);"><div style="position:absolute; top:0; left:0; right:0; height:6px; background:linear-gradient(90deg, #E1306C, #C13584, #E1306C); border-radius:16px 16px 0 0;"></div><div style="text-align:center; margin-bottom:30px; margin-top:5px;"><div style="font-size:11px; letter-spacing:4px; color:#E1306C; font-weight:700; text-transform:uppercase; margin-bottom:4px;">📱 Lanzamiento</div><div style="font-family: Georgia, \'Times New Roman\', serif; font-size:32px; font-weight:700; color:#1a202c; letter-spacing:-0.5px;">Publicación para Redes Sociales</div><div style="width:60px; height:3px; background:linear-gradient(90deg, #E1306C, #C13584); margin:10px auto 0;"></div></div><div style="display:flex; flex-wrap:wrap; gap:10px 20px; background:#f8fafc; padding:14px 20px; border-radius:10px; margin-bottom:25px; border-left:4px solid #E1306C;"><div style="display:flex; align-items:center; gap:8px; font-size:13px; color:#2d3748;"><span style="font-weight:600; color:#E1306C; min-width:85px;">📌 Plataforma:</span><span>Instagram + LinkedIn</span></div><div style="display:flex; align-items:center; gap:8px; font-size:13px; color:#2d3748;"><span style="font-weight:600; color:#E1306C; min-width:85px;">🎯 Objetivo:</span><span>Tráfico y registro</span></div></div><div style="margin-bottom:25px;"><div style="font-size:12px; font-weight:700; color:#E1306C; text-transform:uppercase; letter-spacing:2px; margin-bottom:8px;">🏷️ Hashtags</div><div style="display:flex; flex-wrap:wrap; gap:6px;"><span style="background:linear-gradient(135deg, #fdf2f8, #fce7f3); color:#C13584; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:500;">#productividad</span><span style="background:linear-gradient(135deg, #fdf2f8, #fce7f3); color:#C13584; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:500;">#herramientasIA</span><span style="background:linear-gradient(135deg, #fdf2f8, #fce7f3); color:#C13584; padding:6px 16px; border-radius:20px; font-size:13px; font-weight:500;">#emprendimiento</span></div></div><div style="margin-bottom:25px;"><div style="font-size:12px; font-weight:700; color:#E1306C; text-transform:uppercase; letter-spacing:2px; margin-bottom:8px;">📝 Texto</div><div style="background:#f8fafc; padding:16px 20px; border-radius:10px; border:1px solid #e2e8f0; font-size:14px; color:#2d3748; line-height:1.7;">Lanzamos nuestra nueva función de <strong style="color:#E1306C;">plantillas inteligentes</strong> para que crees documentos, informes y post en segundos. <span style="background:#fef3f7; padding:2px 8px; border-radius:4px; font-weight:600; color:#C13584;">Prueba gratuita</span> disponible esta semana.</div></div><div style="margin-bottom:25px;"><div style="font-size:12px; font-weight:700; color:#E1306C; text-transform:uppercase; letter-spacing:2px; margin-bottom:8px;">🎬 Media sugerida</div><div style="display:flex; flex-direction:column; gap:8px; padding-left:4px;"><div style="display:flex; align-items:center; gap:12px; background:#fafbfc; padding:10px 16px; border-radius:8px; border:1px solid #eef0f4;"><span style="font-size:18px;">🎥</span><span style="font-size:14px; color:#2d3748;"><strong>Reel:</strong> mostrando 3 plantillas en 15 segundos</span></div><div style="display:flex; align-items:center; gap:12px; background:#fafbfc; padding:10px 16px; border-radius:8px; border:1px solid #eef0f4;"><span style="font-size:18px;">🖼️</span><span style="font-size:14px; color:#2d3748;"><strong>Imagen:</strong> comparativa antes/después</span></div><div style="display:flex; align-items:center; gap:12px; background:#fafbfc; padding:10px 16px; border-radius:8px; border:1px solid #eef0f4;"><span style="font-size:18px;">📱</span><span style="font-size:14px; color:#2d3748;"><strong>Story:</strong> con botón de registro</span></div></div></div><div style="background:linear-gradient(135deg, #fef3f7, #fce7f3); padding:18px 22px; border-radius:12px; border:2px solid #E1306C; margin-bottom:25px;"><div style="font-size:12px; font-weight:700; color:#E1306C; text-transform:uppercase; letter-spacing:2px; margin-bottom:6px;">📢 Call to action</div><div style="font-size:16px; color:#1a202c; line-height:1.5; font-weight:600;">“Prueba gratis hoy y dinos qué plantilla necesitas”</div><div style="display:inline-block; background:#E1306C; color:white; padding:4px 18px; border-radius:20px; font-size:13px; font-weight:600; margin-top:8px;">🔗 Enlace en bio</div></div><div style="border-top:2px solid #e2e8f0; padding-top:18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;"><div style="display:flex; gap:12px; font-size:12px; color:#718096;"><span>📊 Alcance estimado: 5K+</span><span>⚡ Engagement: alto</span></div><div style="font-size:11px; color:#a0aec0; text-transform:uppercase; letter-spacing:0.5px;">Publicación programada · 30/07/2026</div></div></div></div>'
  },
  {
    id: 'redes-vibrantes',
    label: 'tplRedesVibrantes',
    html: '<div style="width:100%; min-height:100%; margin:0; padding:0; box-sizing:border-box; font-family:\'Segoe UI\', Arial, sans-serif; background:linear-gradient(135deg, #fdf2f8, #fce7f3); display:flex; justify-content:center; align-items:center; padding:40px 20px;"><div style="width:210mm; min-height:297mm; zoom:1.3228; background:#ffffff; border-radius:20px; box-shadow:0 20px 60px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.05); padding:45px 50px 40px 50px;"><div style="text-align:center; margin-bottom:28px;"><div style="display:inline-block; background:linear-gradient(135deg, #E1306C, #C13584); color:#fff; padding:4px 20px; border-radius:20px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:2px;">🚀 Lanzamiento</div><div style="font-size:28px; font-weight:700; color:#1a1a2e; margin-top:10px; font-family:\'Georgia\', serif;">Publicación para Redes</div></div><div style="display:flex; justify-content:center; gap:20px; flex-wrap:wrap; background:#f8f9fa; padding:12px 20px; border-radius:12px; margin-bottom:22px;"><span style="font-size:13px; color:#555;"><span style="font-weight:600; color:#E1306C;">📌</span> Instagram + LinkedIn</span><span style="font-size:13px; color:#555;"><span style="font-weight:600; color:#E1306C;">🎯</span> Tráfico y registro</span></div><div style="display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-bottom:22px;"><span style="background:linear-gradient(135deg, #fdf2f8, #fce7f3); color:#C13584; padding:5px 14px; border-radius:20px; font-size:12px; font-weight:500;">#productividad</span><span style="background:linear-gradient(135deg, #fdf2f8, #fce7f3); color:#C13584; padding:5px 14px; border-radius:20px; font-size:12px; font-weight:500;">#herramientasIA</span><span style="background:linear-gradient(135deg, #fdf2f8, #fce7f3); color:#C13584; padding:5px 14px; border-radius:20px; font-size:12px; font-weight:500;">#emprendimiento</span></div><div style="background:linear-gradient(135deg, #fafafa, #f5f5f5); padding:18px 22px; border-radius:12px; border:1px solid #eee; margin-bottom:20px;"><div style="font-size:14px; color:#333; line-height:1.7;">Lanzamos nuestra nueva función de <span style="font-weight:700; color:#E1306C;">plantillas inteligentes</span> para que crees documentos, informes y post en segundos. <span style="background:#fef3f7; padding:2px 10px; border-radius:4px; font-weight:600; color:#C13584;">Prueba gratuita</span> disponible esta semana.</div></div><div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:22px;"><div style="background:#f8f9fa; padding:10px; border-radius:8px; text-align:center; font-size:12px; color:#555;"><span style="display:block; font-size:22px; margin-bottom:4px;">🎥</span>Reel · 3 plantillas</div><div style="background:#f8f9fa; padding:10px; border-radius:8px; text-align:center; font-size:12px; color:#555;"><span style="display:block; font-size:22px; margin-bottom:4px;">🖼️</span>Antes/Después</div><div style="background:#f8f9fa; padding:10px; border-radius:8px; text-align:center; font-size:12px; color:#555;"><span style="display:block; font-size:22px; margin-bottom:4px;">📱</span>Story · Registro</div></div><div style="background:linear-gradient(135deg, #E1306C, #C13584); padding:16px 20px; border-radius:12px; text-align:center; color:#fff;"><div style="font-size:12px; text-transform:uppercase; letter-spacing:2px; opacity:0.8;">Call to action</div><div style="font-size:18px; font-weight:600; margin:4px 0;">“Prueba gratis hoy y dinos qué plantilla necesitas”</div><div style="display:inline-block; background:rgba(255,255,255,0.2); padding:4px 18px; border-radius:20px; font-size:13px; font-weight:500; margin-top:6px;">🔗 Enlace en bio</div></div><div style="border-top:1px solid #eee; margin-top:18px; padding-top:14px; display:flex; justify-content:space-between; font-size:11px; color:#aaa;"><span>📊 Alcance estimado: 5K+</span><span>📅 30/07/2026</span></div></div></div>'
  }
];

const SaveDocumentProjectForm = ({
  onSave,
  onClose,
  isSaving
}: {
  onSave: (title: string) => Promise<void>,
  onClose: () => void,
  isSaving: boolean
}) => {
  const { t } = useI18n();
  const [title, setTitle] = useState('');

  return (
    <div className="space-y-4 p-4 text-white">
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-300">{t('editorHTML.docEditor.saveNameLabel')}</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('editorHTML.docEditor.saveNamePlaceholder')}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-white outline-none focus:ring-2 focus:ring-green-500"
          autoFocus
        />
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="ghost" onClick={onClose} disabled={isSaving}>{t('editorHTML.docEditor.cancel')}</Button>
        <Button
          onClick={() => onSave(title)}
          disabled={isSaving || !title.trim()}
          className="bg-green-600 hover:bg-green-700"
        >
          {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          Guardar Proyecto
        </Button>
      </div>
    </div>
  );
};

export default function DocumentEditor({
  documentUrl: initialUrl,
  fileName: initialName = 'documento.txt',
  initialContent = '',
  isLocalProject: initialIsLocal = false,
  projectName: initialProjectName = '',
  projectPath: initialProjectPath = '',
  onSave,
  onCancel,
  onFormatChange
}: DocumentEditorProps) {
  const { t } = useI18n();
  // --- Fuentes locales (carpeta «Fuentes» configurada en la pestaña Archivo) ---
  const { localFonts, localFontsLoading, loadLocalFonts, ensureLocalFontFace } = useLocalFonts();
  const editorRef = useRef<HTMLDivElement>(null);
  // Span wrapper creado por el último applyStyleToSelection (sliders de Interlineado
  // / Espaciado Letras). Lo guardamos para que movimientos sucesivos del slider sobre
  // el mismo texto ACTUALICEN el span en vez de anidar otro (y así el valor pueda bajar
  // además de subir). Sin esto, extractContents destruye la selección tras el 1.er
  // movimiento y los siguientes no encuentran nada que envolver => el slider se queda
  // "bloqueado" en el valor más alto aplicado.
  const activeStyleSpanRef = useRef<HTMLSpanElement | null>(null);
  const handleContentChangeRef = useRef<(newHtml: string) => void>(() => { });
  const latestHtmlRef = useRef(initialContent);
  const aiBridge = useAIEditorBridgeOptional();
  const [htmlContent, setHtmlContent] = useState(initialContent);
  const [currentDocumentUrl, setCurrentDocumentUrl] = useState(initialUrl);
  const [currentFileName, setCurrentFileName] = useState(initialName);
  const [history, setHistory] = useState<string[]>([initialContent]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isCopied, setIsCopied] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [fontSize, setFontSize] = useState(14);
  const [fontFamily, setFontFamily] = useState('monospace');
  // Nombre de una fuente de Google Fonts para aplicar al texto (igual que el
  // editor HTML). Se carga vía <link> a fonts.googleapis.com al pulsar Aplicar.
  const [customFont, setCustomFont] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('A4');
  const [activeSidebarTab, setActiveSidebarTab] = useState('format');

  // Gestión de Páginas
  const [pages, setPages] = useState<string[]>([initialContent || '']);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);

  // Estado para formas y objetos
  const [selectedElement, setSelectedElement] = useState<HTMLElement | null>(null);
  const [shapeStyle, setShapeStyle] = useState({ bg: '#3b82f6', border: '#ffffff', thickness: 2, rotation: 0, width: 300, left: 0, top: 0 });
  // Mostrar/ocultar el borde discontinuo de guía de los cuadros de texto en el
  // editor. No afecta al borde explícito (inline) que el usuario ponga desde el
  // panel ni al exportado (la regla CSS no viaja al HTML/PDF).
  const [showTextboxGuide, setShowTextboxGuide] = useState(true);

  // Márgenes dinámicos
  const [margins, setMargins] = useState({ left: 48, right: 48 });
  const [draggingMargin, setDraggingMargin] = useState<'left' | 'right' | null>(null);

  // Estados para dibujar
  const [isDrawingTextMode, setIsDrawingTextMode] = useState(false);
  const [isDrawingRectMode, setIsDrawingRectMode] = useState(false);
  const [isDrawingLineMode, setIsDrawingLineMode] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [drawRect, setDrawRect] = useState({ top: 0, left: 0, width: 0, height: 0 });
  // Vista previa de línea mientras se dibuja: left/top = punto inicial, width = longitud, angle = grados.
  const [linePreview, setLinePreview] = useState({ left: 0, top: 0, width: 0, angle: 0 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // 1. Arrastre de Márgenes
    if (draggingMargin) {
      const ruler = document.getElementById('ruler-container');
      if (!ruler) return;
      const rect = ruler.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const width = rect.width;
      if (draggingMargin === 'left') {
        setMargins(prev => ({ ...prev, left: Math.max(0, Math.min(x, width - margins.right - 40)) }));
      } else {
        setMargins(prev => ({ ...prev, right: Math.max(0, Math.min(width - x, width - margins.left - 40)) }));
      }
      return;
    }

    // 2. Dibujo de Cuadro de Texto / Rectángulo / Línea
    if (isDrawing) {
      const container = editorRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const currentX = e.clientX - containerRect.left;
      const currentY = e.clientY - containerRect.top;

      if (isDrawingLineMode) {
        const dx = currentX - startPos.x;
        const dy = currentY - startPos.y;
        const width = Math.sqrt(dx * dx + dy * dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        setLinePreview({ left: startPos.x, top: startPos.y, width, angle });
      } else {
        setDrawRect({
          left: Math.min(startPos.x, currentX),
          top: Math.min(startPos.y, currentY),
          width: Math.abs(currentX - startPos.x),
          height: Math.abs(currentY - startPos.y)
        });
      }
      return;
    }
  }, [draggingMargin, margins, isDrawing, isDrawingLineMode, startPos]);

  const handleMouseUpPaper = () => {
    if (isDrawing) {
      // --- Línea dibujada con el ratón ---
      if (isDrawingLineMode) {
        if (linePreview.width > 10) {
          const id = `shape-${Date.now()}`;
          editorRef.current?.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));
          const thickness = shapeStyle.thickness;
          // La línea parte del punto inicial (left/top) y rota desde su extremo
          // izquierdo (transform-origin: 0 50%) para que el ángulo coincida con
          // el arrastre. top se centra verticalmente según el grosor.
          const html = `<div id="${id}" class="shape-line is-selected" contenteditable="false" style="position:absolute; left:${linePreview.left}px; top:${linePreview.top - thickness / 2}px; width:${linePreview.width}px; height:${thickness}px; background-color:${shapeStyle.bg}; cursor:move; z-index:50; transform: rotate(${linePreview.angle}deg); transform-origin: 0 50%; box-shadow: 0 0 0 10px transparent;"></div>`;
          if (editorRef.current) {
            editorRef.current.insertAdjacentHTML('beforeend', html);
            const el = document.getElementById(id);
            if (el) setSelectedElement(el);
            handleContentChange(editorRef.current.innerHTML);
          }
        }
      } else if (drawRect.width > 10 && drawRect.height > 10) {
        const id = `shape-${Date.now()}`;
        editorRef.current?.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));

        let html = '';
        if (isDrawingRectMode) {
          html = `<div id="${id}" class="shape-rect is-selected" contenteditable="false" style="position:absolute; top:${drawRect.top}px; left:${drawRect.left}px; width:${drawRect.width}px; height:${drawRect.height}px; background-color:${shapeStyle.bg}; border:${shapeStyle.thickness}px solid ${shapeStyle.border}; overflow:visible; border-radius:4px; cursor:move; z-index:10; transform: rotate(${shapeStyle.rotation}deg); resize:both;">
            <div class="resize-handle handle-nw" contenteditable="false"></div>
            <div class="resize-handle handle-ne" contenteditable="false"></div>
            <div class="resize-handle handle-sw" contenteditable="false"></div>
            <div class="resize-handle handle-se" contenteditable="false"></div>
          </div>`;
        } else if (isDrawingTextMode) {
          // Se inicializa con un <p><br></p> (bloque) para que el caret y el texto
          // vivan DENTRO de un elemento de bloque. Sin esto, el texto queda como
          // text-node suelto del contentEditable y el Enter por defecto colapsa el
          // cursor al principio del cuadro en vez de bajar de línea.
          html = `<div id="${id}" class="shape-textbox is-selected" contenteditable="true" style="position:absolute; top:${drawRect.top}px; left:${drawRect.left}px; width:${drawRect.width}px; height:${drawRect.height}px; background-color:transparent; padding:8px; overflow:visible; cursor:text; z-index:20; color:white; font-family:inherit; outline:none; box-sizing:border-box; resize:both;">
            <p><br></p>
            <div class="resize-handle handle-nw" contenteditable="false"></div>
            <div class="resize-handle handle-ne" contenteditable="false"></div>
            <div class="resize-handle handle-sw" contenteditable="false"></div>
            <div class="resize-handle handle-se" contenteditable="false"></div>
            <div class="handle-move" contenteditable="false"></div>
          </div>`;
        }

        if (editorRef.current && html) {
          editorRef.current.insertAdjacentHTML('beforeend', html);
          const el = document.getElementById(id);
          if (el) {
            setSelectedElement(el);
            if (isDrawingTextMode) {
              el.focus();
              // Colocar el caret dentro del <p> inicial (no al nivel del div), para
              // que escribir y Enter funcionen desde el primer carácter.
              const p = el.querySelector('p');
              if (p) {
                const range = document.createRange();
                range.selectNodeContents(p);
                range.collapse(true);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
              }
            }
          }
          handleContentChange(editorRef.current.innerHTML);
        }
      }
    }
    // RESET TOTAL DE ESTADOS
    setIsDrawing(false);
    setIsDrawingTextMode(false);
    setIsDrawingRectMode(false);
    setIsDrawingLineMode(false);
    setLinePreview({ left: 0, top: 0, width: 0, angle: 0 });
    setDraggingMargin(null);
    setIsDraggingShape(false);
  };

  const handleMouseDownPaper = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    if (target.closest('.shape-rect, .shape-line, .shape-textbox')) {
      const element = target.closest('.shape-rect, .shape-line, .shape-textbox') as HTMLElement;
      handleShapeMouseDown(e, element);
      return;
    }

    if (isDrawingTextMode || isDrawingRectMode || isDrawingLineMode) {
      const container = editorRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      setIsDrawing(true);
      setStartPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setLinePreview({ left: e.clientX - rect.left, top: e.clientY - rect.top, width: 0, angle: 0 });
      return;
    }

    editorRef.current?.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));
    setSelectedElement(null);
  };
  // Función para obtener las dimensiones del papel en cm según el formato
  const getPaperDimensions = (format: string) => {
    const dimensions: Record<string, { width: number; height: number }> = {
      'A3': { width: 29.7, height: 42.0 },
      'A4': { width: 21.0, height: 29.7 },
      'A5': { width: 14.8, height: 21.0 },
      'Letter': { width: 21.6, height: 27.9 },
      'Legal': { width: 21.6, height: 35.6 }
    };
    return dimensions[format] || dimensions['A4'];
  };

  const paperDimensions = getPaperDimensions(selectedFormat);

  // Estados de Estilo Local (para el toolbar)
  const [activeStyles, setActiveStyles] = useState({
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    list: null as 'ul' | 'ol' | null
  });

  // Estados para PocketBase
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isDraggingShape, setIsDraggingShape] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const [savedProjects, setSavedProjects] = useState<any[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);

  // Estados para Carga y Exportación
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [exportConfig, setExportConfig] = useState({ title: 'mi_documento_final', format: 'text/html' });
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [loadType, setLoadType] = useState<'proyectos' | 'archivos' | 'local'>('archivos');
  const [localFolderFiles, setLocalFolderFiles] = useState<any[]>([]);
  const [pbLoadStep, setPbLoadStep] = useState<'collection' | 'record' | 'file' | 'local'>('collection');
  const [pbCollections, setPbCollections] = useState<{ id: string; name: string }[]>([]);
  const [selectedPbCollection, setSelectedPbCollection] = useState<string | null>(null);
  const [pbRecords, setPbRecords] = useState<{ recordId: string; recordName: string; files: { url: string; fileName: string }[] }[]>([]);
  const [selectedPbRecordFiles, setSelectedPbRecordFiles] = useState<{ url: string; fileName: string }[] | null>(null);
  const [pbLoading, setPbLoading] = useState(false);
  const [fileNotAllowedMessage, setFileNotAllowedMessage] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Última imagen insertada o seleccionada (clic sobre ella) por el usuario. La
  // usan los botones de alineación Izquierda/Centro/Derecha para saber a qué
  // <div class="img-wrapper"> aplicar display:block + margins (centro/derecha) o
  // inline-block (izquierda).
  const selectedImageRef = useRef<HTMLDivElement | null>(null);
  const isInitialized = useRef(false);

  const resolveUrl = useCallback((url: string) => {
    if (!url) return '';
    if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('http')) {
      return url;
    }
    // Si es una ruta relativa de PocketBase
    if (url.startsWith('/')) {
      const baseUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL || process.env.NEXT_PUBLIC_PB_URL || 'http://127.0.0.1:8090';
      return baseUrl + url;
    }
    return url;
  }, []);

  const isPdf = useMemo(() => {
    const url = currentDocumentUrl.toLowerCase();
    const name = currentFileName.toLowerCase();
    return url.endsWith('.pdf') || name.endsWith('.pdf') || (url.startsWith('blob:') && name.endsWith('.pdf'));
  }, [currentDocumentUrl, currentFileName]);

  const resolvedDocumentUrl = useMemo(() => resolveUrl(currentDocumentUrl), [currentDocumentUrl, resolveUrl]);

  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentFileRecord, setCurrentFileRecord] = useState<{ id: string, collection: string } | null>(null);
  const [currentLocalPath, setCurrentLocalPath] = useState<string | null>(null);

  async function loadFullProjectLocal(project: any) {
    setPbLoading(true);
    console.log("📥 [DocumentEditor] Cargando proyecto local:", project.name);
    try {
      const data = await readProject(project.path);
      if (!data) throw new Error(t('editorHTML.docEditor.errZeusConfig'));

      const dataObj = data.file || data.editState || data;

      if (dataObj.pages) {
        console.log("📄 [DocumentEditor] Datos de páginas encontrados, inyectando...");

        // Bloqueamos inicializaciones por defecto
        isInitialized.current = true;

        setPages(dataObj.pages);
        setMargins(dataObj.margins || { left: 48, right: 48 });
        setSelectedFormat(dataObj.format || 'A4');
        setCurrentPageIndex(0);
        setHtmlContent(dataObj.pages[0] || '');

        // Inyección inmediata con reintento por si el DOM no está listo
        const inject = () => {
          if (editorRef.current) {
            editorRef.current.innerHTML = dataObj.pages[0] || '';
            console.log("✅ [DocumentEditor] HTML inyectado con éxito");
          } else {
            setTimeout(inject, 50);
          }
        };
        inject();

        setCurrentLocalPath(project.path.endsWith('.zeus') ? project.path : `${project.path}${project.path.includes('\\') ? '\\' : '/'}${project.name}.zeus`);
        setCurrentFileName(project.name);
      } else {
        console.error("❌ [DocumentEditor] No se encontraron páginas en el proyecto");
        throw new Error(t('editorHTML.docEditor.errInvalidFormat'));
      }
    } catch (e: any) {
      console.error('❌ Error loadFullProjectLocal:', e);
      alert(t('editorHTML.docEditor.errLoadLocal', { msg: e.message }));
    } finally {
      setPbLoading(false);
    }
  }

  // Carga automática por ID de proyecto o parámetros locales
  useEffect(() => {
    setMounted(true);

    // Prioridad 1: Props pasadas directamente
    if (initialIsLocal && initialProjectPath) {
      console.log('📂 Auto-cargando proyecto de texto local (desde props):', initialProjectName);
      loadFullProjectLocal({ name: initialProjectName, path: initialProjectPath });
      return;
    }

    // Prioridad 2: Parámetros en la URL (fallback)
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('projectId');
    const isLocalProject = params.get('isLocalProject');
    const localProjectName = params.get('projectName');
    const localProjectPath = params.get('projectPath');
    const url = params.get('url');

    if (isLocalProject === 'true' && localProjectPath) {
      console.log('📂 Auto-cargando proyecto de texto local (desde URL):', localProjectName);
      loadFullProjectLocal({ name: localProjectName, path: localProjectPath });
    } else if (projectId) {
      setCurrentProjectId(projectId);
      console.log('📄 Cargando documento:', projectId);
      pb.collection('proyectos').getOne(projectId, { requestKey: null }).then((record) => {
        // ... resto de lógica de carga de nube ...
        if (record.file_text_rich) {
          try {
            const data = JSON.parse(record.file_text_rich);
            if (data.pages) {
              setPages(data.pages);
              if (data.format) setSelectedFormat(data.format);
              if (data.margins) setMargins(data.margins);
              setHtmlContent(data.pages[0] || '');
              if (editorRef.current) editorRef.current.innerHTML = data.pages[0] || '';
              isInitialized.current = true;
              return;
            }
          } catch (e) {
            setPages([record.file_text_rich]);
            setHtmlContent(record.file_text_rich);
            if (editorRef.current) editorRef.current.innerHTML = record.file_text_rich;
            isInitialized.current = true;
            return;
          }
        }
        const data = typeof record.file === 'string' ? JSON.parse(record.file) : record.file;
        if (data && data.pages) {
          setPages(data.pages);
          if (data.format) setSelectedFormat(data.format);
          if (data.margins) setMargins(data.margins);
          setHtmlContent(data.pages[0] || '');
          if (editorRef.current) editorRef.current.innerHTML = data.pages[0] || '';
          isInitialized.current = true;
        }
      }).catch(e => console.error('Error cargando documento:', e));
    } else if (url && url.includes('/api/files/')) {
      // Intentar detectar si es un archivo de PocketBase para permitir guardado directo
      try {
        const parts = url.split('/api/files/')[1].split('/');
        const collection = parts[0];
        const recordId = parts[1];
        if (collection && recordId) {
          console.log(`🔍 Detectado archivo de PocketBase: Colección=${collection}, ID=${recordId}`);
          setCurrentFileRecord({ id: recordId, collection });
        }
      } catch (e) {
        console.warn('No se pudo determinar el ID del registro desde la URL');
      }
    }
  }, []);

  const handleQuickSave = async () => {
    if (!currentProjectId && !currentFileRecord && !currentLocalPath) {
      // Si no hay contexto, abrir el modal de guardado normal
      setIsSaveModalOpen(true);
      return;
    }

    setIsSavingProject(true);
    try {
      const currentHTML = editorRef.current?.innerHTML || '';
      const updatedPages = [...pages];
      updatedPages[currentPageIndex] = currentHTML;
      setPages(updatedPages);

      if (currentLocalPath) {
        // GUARDADO LOCAL DIRECTO
        const projectData = {
          pages: updatedPages,
          margins,
          format: selectedFormat,
          version: '1.0'
        };

        const lastSlash = currentLocalPath.lastIndexOf('\\');
        const folder = currentLocalPath.substring(0, lastSlash);
        const fileName = currentLocalPath.substring(lastSlash + 1);

        await ensureDir(folder);
        const destPath = folder + '\\' + fileName;
        const ok = await writeFile(destPath, JSON.stringify({
          titulo: fileName.replace('.zeus', ''),
          tipo: 'edit_documento',
          file: projectData
        }));

        if (!ok) throw new Error(t('editorHTML.docEditor.errSaveLocal'));
        alert(t('editorHTML.docEditor.savedLocal'));
      }
      else if (currentProjectId) {
        // ACTUALIZAR PROYECTO EXISTENTE EN NUBE
        const projectData = {
          pages: updatedPages,
          margins,
          format: selectedFormat
        };
        await pb.collection('proyectos').update(currentProjectId, {
          file_text_rich: JSON.stringify(projectData)
        });
        alert(t('editorHTML.docEditor.savedCloud'));
      }
      else if (currentFileRecord) {
        // ACTUALIZAR ARCHIVO EN COLECCIÓN NUBE
        if (currentFileRecord.collection === 'documentos' || currentFileRecord.collection === 'v8qus4vvwwehnfr') {
          const metaData = `<!-- Zeus_METADATA: ${JSON.stringify({ margins, format: selectedFormat })} -->`;
          const pagesContent = updatedPages.map((p, i) => `<section class="Zeus-page">${p}</section>`).join('<hr>');
          const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">${metaData}</head><body>${pagesContent}</body></html>`;

          const blob = new Blob([fullHtml], { type: 'text/html' });
          const file = new File([blob], currentFileName, { type: 'text/html' });

          const formData = new FormData();
          formData.append('file', file);

          await pb.collection(currentFileRecord.collection).update(currentFileRecord.id, formData);
          alert(t('editorHTML.docEditor.savedCloudFile'));
        }
      }
    } catch (error) {
      console.error('Error en guardado rápido:', error);
      alert(t('editorHTML.docEditor.errUpdateChanges'));
    } finally {
      setIsSavingProject(false);
    }
  };

  useEffect(() => {
    // Inicialización única: solo si no se ha hecho ya
    if (editorRef.current && !isPdf && !isInitialized.current) {
      if (initialContent) {
        editorRef.current.innerHTML = initialContent;
        setHtmlContent(initialContent);
        setPages([initialContent]);
        setHistory([initialContent]);
        setHistoryIndex(0);
        isInitialized.current = true;
      } else if (resolvedDocumentUrl) {
        // Si no hay contenido inicial pero hay URL, descargar el texto
        console.log('📥 Descargando contenido de texto desde URL:', resolvedDocumentUrl);
        fetch(resolvedDocumentUrl)
          .then(res => res.text())
          .then(text => {
            if (editorRef.current) {
              // Si parece ser un archivo de texto plano (no HTML), formatearlo un poco
              let formattedText = text;
              if (!text.trim().startsWith('<') && !text.includes('</')) {
                formattedText = text.replace(/\n/g, '<br>');
              }

              editorRef.current.innerHTML = formattedText;
              setHtmlContent(formattedText);
              setPages([formattedText]);
              setHistory([formattedText]);
              setHistoryIndex(0);
              isInitialized.current = true;
            }
          })
          .catch(err => console.error('Error al descargar contenido:', err));
      }
    }
  }, [initialContent, isPdf, resolvedDocumentUrl]);

  // Resetear la inicialización solo si el archivo real cambia (URL diferente)
  useEffect(() => {
    isInitialized.current = false;
    // Configurar separador por defecto para mejor compatibilidad con listas
    document.execCommand('defaultParagraphSeparator', false, 'p');
  }, [initialUrl]);

  // Re-enlazar eventos de arrastre al cargar o cambiar contenido
  useEffect(() => {
    const shapes = editorRef.current?.querySelectorAll('.shape-rect, .shape-line, .shape-textbox');
    shapes?.forEach((s: any) => {
      // Cuadros de texto antiguos (creados antes de la lengüeta de movimiento):
      // les inyectamos el handle-move si les falta. Idempotente y silencioso (no
      // dispara handleContentChange) => no reactiva este effect. El siguiente
      // guardado persistirá la lengüeta, igual que los tiradores de esquina.
      if (s.classList.contains('shape-textbox') && !s.querySelector('.handle-move')) {
        const grip = document.createElement('div');
        grip.className = 'handle-move';
        grip.setAttribute('contenteditable', 'false');
        s.appendChild(grip);
      }
      s.onmousedown = (e: any) => handleShapeMouseDown(e, s);
      // Cuadro de texto: Enter inserta un <br> a mano. El behavior por defecto
      // (insertParagraph) en un contentEditable anidado con hermanos no editables
      // (los tiradores) colapsa el caret al principio del cuadro.
      if (s.classList.contains('shape-textbox')) {
        s.onkeydown = (e: KeyboardEvent) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const sel = window.getSelection();
          if (!sel || !sel.rangeCount) return;
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const br = document.createElement('br');
          range.insertNode(br);
          // Si tras el <br> no queda contenido editable (fin del texto o sólo los
          // tiradores no editables), la nueva línea vacía no se renderiza: añadimos
          // un segundo <br> marcador y dejamos el caret entre ambos.
          const next = br.nextSibling;
          const nextIsHandle = !!next && next.nodeType === 1 && (next as HTMLElement).classList.contains('resize-handle');
          if (!next || nextIsHandle) {
            const extra = document.createElement('br');
            br.parentNode!.insertBefore(extra, br.nextSibling);
          }
          const newRange = document.createRange();
          newRange.setStartAfter(br);
          newRange.collapse(true);
          sel.removeAllRanges();
          sel.addRange(newRange);
          handleContentChangeRef.current(editorRef.current?.innerHTML || '');
        };
      }
    });

    // Imágenes: clic sobre un .img-wrapper lo marca como imagen seleccionada
    // (selectedImageRef) para que los botones de alineación actúen sobre él.
    // No hacemos preventDefault: el caret se coloca junto a la imagen y el
    // resize nativo (esquina) sigue funcionando. Sólo marcamos el borde.
    const imgs = editorRef.current?.querySelectorAll('.img-wrapper');
    imgs?.forEach((w: any) => {
      w.onclick = () => {
        editorRef.current?.querySelectorAll('.img-wrapper.is-selected')
          .forEach(el => el.classList.remove('is-selected'));
        w.classList.add('is-selected');
        selectedImageRef.current = w as HTMLDivElement;
      };
    });
  }, [htmlContent]);

  // Sincronizar la clase .show-textbox-guide en el contenedor editable según el
  // toggle. Se hace por classList (no re-renderiza el contentEditable) para no
  // mover el caret. La regla CSS del borde discontinuo sólo aplica con esta clase.
  useEffect(() => {
    editorRef.current?.classList.toggle('show-textbox-guide', showTextboxGuide);
  }, [showTextboxGuide]);

  useEffect(() => {
    latestHtmlRef.current = htmlContent;
  }, [htmlContent]);

  // Registrar este editor para que el chat pueda escribir en él y leer el contenido como contexto
  useEffect(() => {
    if (!aiBridge) return;
    const escapeHtml = (t: string) =>
      t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
    const unregisterEditor = aiBridge.registerEditor((text: string) => {
      if (!editorRef.current) return;
      const escaped = escapeHtml(text);
      editorRef.current.innerHTML += '<p>' + escaped + '</p>';
      handleContentChangeRef.current(editorRef.current.innerHTML);
    });
    const stripHtml = (html: string) => {
      const tmp = typeof document !== 'undefined' ? document.createElement('div') : null;
      if (tmp) {
        tmp.innerHTML = html;
        return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
      }
      return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    };
    const unregisterContent = aiBridge.registerDocumentContent(() => {
      const raw = latestHtmlRef.current || editorRef.current?.innerHTML || '';
      const plain = stripHtml(raw);
      return plain || null;
    });
    return () => {
      unregisterEditor();
      unregisterContent();
    };
  }, [aiBridge]);

  if (!mounted) return <div className="h-screen w-screen bg-gray-950 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-green-500" /></div>;

  const handleImageInsert = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      if (editorRef.current) {
        editorRef.current.focus();

        // Insertamos un contenedor que permite redimensionar nativamente con el ratón
        const html = `<div class="img-wrapper" style="display:inline-block; position:relative; line-height:0; vertical-align:middle; margin:10px; resize:both; overflow:hidden; width:300px; border:2px solid transparent;">
                        <img src="${url}" style="width:100%; height:100%; object-fit:contain; pointer-events:none;" />
                      </div>&nbsp;`;

        document.execCommand('insertHTML', false, html);

        // Seleccionar la imagen recién insertada (la última .img-wrapper del
        // editor) para que los botones de alineación actúen sobre ella.
        const wrappers = editorRef.current.querySelectorAll('.img-wrapper');
        if (wrappers.length) {
          selectedImageRef.current = wrappers[wrappers.length - 1] as HTMLDivElement;
        }

        // Guardar el cambio inmediatamente
        handleContentChange(editorRef.current.innerHTML);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Alinea la imagen seleccionada (selectedImageRef) a la izquierda/centro/derecha.
  // Izquierda = inline-block (queda en el flujo del texto, al inicio de la línea,
  // que es el comportamiento por defecto). Centro/Derecha = display:block con
  // margins auto para sacarla del flujo inline y empujarla al centro/final de su
  // propia línea.
  const alignImage = (align: 'left' | 'center' | 'right') => {
    const img = selectedImageRef.current;
    if (!img || !editorRef.current?.contains(img)) {
      alert(t('editorHTML.docEditor.errSelectImage'));
      return;
    }
    if (align === 'left') {
      img.style.display = 'inline-block';
      img.style.marginLeft = '0';
      img.style.marginRight = 'auto';
    } else if (align === 'center') {
      img.style.display = 'block';
      img.style.marginLeft = 'auto';
      img.style.marginRight = 'auto';
    } else {
      img.style.display = 'block';
      img.style.marginLeft = 'auto';
      img.style.marginRight = '0';
    }
    handleContentChange(editorRef.current?.innerHTML || '');
  };

  // Carga una fuente de Google Fonts inyectando un <link> a fonts.googleapis.com
  // (deduplica por href para no repetir la misma fuente). Es necesario para que la
  // fuente se renderice al aplicarla al texto. No se serializa al exportar (el
  // link vive en <head>, no en el innerHTML del editor).
  const loadGoogleFont = (fontName: string) => {
    if (typeof document === 'undefined') return;
    const family = fontName.trim().replace(/ /g, '+');
    if (!family) return;
    const href = `https://fonts.googleapis.com/css2?family=${family}:wght@400;700&display=swap`;
    const exists = document.querySelector(`link[href="${href}"]`);
    if (exists) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  };

  // Aplica la fuente de Google Fonts al texto: la carga y la aplica a la
  // selección actual (o al caret para lo que se escriba a continuación) vía
  // execCommand('fontName'). Si no hay caret en el editor, la deja como fuente
  // por defecto del documento.
  const applyCustomFont = () => {
    const name = customFont.trim();
    if (!name) return;
    loadGoogleFont(name);
    const fontValue = `'${name}', sans-serif`;
    if (editorRef.current) {
      editorRef.current.focus();
      // Si hay una selección de texto no colapsada, se la aplica; si no, queda
      // como fuente activa para lo que se escriba a partir del caret.
      document.execCommand('fontName', false, fontValue);
      handleContentChange(editorRef.current.innerHTML);
    } else {
      setFontFamily(fontValue);
    }
  };

  const execCommand = (command: string, value: string = '') => {
    if (editorRef.current) {
      editorRef.current.focus();
    }
    document.execCommand(command, false, value);
    if (editorRef.current) {
      handleContentChange(editorRef.current.innerHTML);
    }
    checkActiveStyles();
  };

  // Botones Puntos / Números: crean una lista <ul>/<ol> a partir de la línea actual.
  // No usamos document.execCommand('insertUnorderedList'/'insertOrderedList') porque
  // esos comandos de bloque fallan silenciosamente cuando no hay caret/selección válida
  // en el editor (bold sí funciona porque es inline). Lo hacemos a mano: si el caret ya
  // está en una lista del mismo tipo, la deshacemos (toggle off); si no, envolvemos el
  // bloque que contiene el caret en <tag><li>. Tras crear la lista, pulsar Enter la
  // continúa nativamente (el handler de Enter sólo intercepta dentro de .shape-textbox).
  const toggleList = (tag: 'ul' | 'ol') => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    let range: Range | null = null;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (editor.contains(r.commonAncestorContainer)) range = r;
    }
    if (!range) {
      // Sin selección válida en el editor: colocar el caret al final.
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }

    // ¿El caret ya está dentro de una lista de este tipo? → toggle off (li -> p).
    let n: Node | null = range.startContainer;
    if (n && n.nodeType === 3) n = n.parentNode;
    let existingList: HTMLElement | null = null;
    let el = n as HTMLElement | null;
    while (el && el !== editor) {
      if (el.tagName === tag.toUpperCase()) { existingList = el; break; }
      el = el.parentElement;
    }
    if (existingList) {
      const items = Array.from(existingList.querySelectorAll('li'));
      const frag = document.createDocumentFragment();
      items.forEach(li => {
        const p = document.createElement('p');
        while (li.firstChild) p.appendChild(li.firstChild);
        if (!p.firstChild) p.appendChild(document.createElement('br'));
        frag.appendChild(p);
      });
      existingList.parentNode?.replaceChild(frag, existingList);
      handleContentChange(editor.innerHTML);
      checkActiveStyles();
      return;
    }

    // Crear lista: envolver el bloque del caret.
    let block: HTMLElement | null = null;
    let node: Node | null = range.startContainer;
    if (node && node.nodeType === 3) node = node.parentNode;
    let walk = node as HTMLElement | null;
    while (walk && walk !== editor) {
      if (walk.nodeType === 1 && /^(P|DIV|H1|H2|H3|H4)$/.test(walk.tagName)) { block = walk; break; }
      walk = walk.parentElement;
    }
    const list = document.createElement(tag);
    const li = document.createElement('li');
    if (block && block.parentNode) {
      while (block.firstChild) li.appendChild(block.firstChild);
      list.appendChild(li);
      block.parentNode.replaceChild(list, block);
    } else {
      const content = range.extractContents();
      li.appendChild(content && content.childNodes.length ? content : document.createElement('br'));
      list.appendChild(li);
      range.insertNode(list);
    }
    const newRange = document.createRange();
    newRange.selectNodeContents(list);
    newRange.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(newRange);
    handleContentChange(editor.innerHTML);
    checkActiveStyles();
  };

  const applyStyleToSelection = (styleName: string, value: string) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const active = activeStyleSpanRef.current;
    const activeInDom = active && editorRef.current?.contains(active);

    // ¿La selección actual cae dentro del span activo? (tras el primer wrap
    // re-seleccionamos el contenido del span, así los siguientes movimientos del
    // slider entran aquí y actualizan el MISMO span en vez de anidar otro).
    const selectionInActive = !!activeInDom &&
      active!.contains(range.startContainer) && active!.contains(range.endContainer);

    try {
      if (selectionInActive) {
        // Actualizar el span existente (sube o baja el valor).
        (active!.style as any)[styleName] = value;
        if (editorRef.current) handleContentChange(editorRef.current.innerHTML);
        return;
      }

      // Selección colapsada y sin span activo útil: nada que envolver.
      if (range.collapsed) return;

      // Selección nueva: envolver en un span fresco y recordarlo.
      const span = document.createElement('span');
      (span.style as any)[styleName] = value;
      const content = range.extractContents();
      span.appendChild(content);
      range.insertNode(span);
      activeStyleSpanRef.current = span;

      // Re-seleccionar el contenido del span para que el siguiente tick del slider
      // vuelva a operar sobre el mismo texto (rama selectionInActive arriba).
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(newRange);

      if (editorRef.current) handleContentChange(editorRef.current.innerHTML);
    } catch (e) {
      console.error('Error applying style:', e);
    }
  };

  const checkActiveStyles = (e?: React.SyntheticEvent) => {
    // Detectar si el caret está dentro de una lista (ul/ol) para el estado activo
    // de los botones Puntos/Números.
    let listType: 'ul' | 'ol' | null = null;
    const sel = window.getSelection();
    if (sel && sel.anchorNode) {
      let n: Node | null = sel.anchorNode;
      if (n.nodeType === 3) n = n.parentNode;
      let el = (n as HTMLElement | null);
      while (el && el !== editorRef.current) {
        if (el.tagName === 'UL') { listType = 'ul'; break; }
        if (el.tagName === 'OL') { listType = 'ol'; break; }
        el = el.parentElement;
      }
    }
    setActiveStyles({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      align: document.queryCommandValue('justifyLeft') === 'true' ? 'left' :
        document.queryCommandValue('justifyCenter') === 'true' ? 'center' :
          document.queryCommandValue('justifyRight') === 'true' ? 'right' : 'left',
      list: listType
    });

    // Determinar la shape "activa". Para eventos de ratón usamos el target del
    // evento (fiable para shapes no editables como líneas/rectángulos, donde
    // clicar NO mueve la selección de texto dentro de la shape). Para keyup (sin
    // target útil) usamos la selección de texto, que sí está dentro del cuadro
    // de texto editable cuando el caret está ahí.
    let element: HTMLElement | null = null;
    if (e && (e.type === 'mouseup' || e.type === 'mousedown')) {
      const target = e.target as HTMLElement | null;
      element = (target && target.closest) ? (target.closest('.shape-rect, .shape-line, .shape-textbox') as HTMLElement | null) : null;
    }
    if (!element) {
      const selection = window.getSelection();
      if (selection && selection.anchorNode) {
        let node = selection.anchorNode as Node;
        if (node.nodeType === 3) node = node.parentNode!;
        element = (node as HTMLElement).closest?.('.shape-rect, .shape-line, .shape-textbox') as HTMLElement | null;
      }
    }

    if (element) {
      editorRef.current?.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));
      element.classList.add('is-selected');
      setSelectedElement(element);
      setActiveSidebarTab('settings');
    } else if (draggingMargin === null && !isDrawing) {
      editorRef.current?.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));
      setSelectedElement(null);
    }
  };
  const handleShapeMouseDown = (e: any, element: HTMLElement) => {
    const target = e.target as HTMLElement;
    const isHandle = target.classList.contains('resize-handle');
    const rect = element.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // 1. Sincronizar selección y panel lateral
    editorRef.current?.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));
    element.classList.add('is-selected');
    setSelectedElement(element);
    setActiveSidebarTab('settings');

    const style = window.getComputedStyle(element);
    let rot = 0;
    try { const matrix = new DOMMatrix(style.transform); rot = Math.round(Math.atan2(matrix.b, matrix.a) * (180 / Math.PI)); } catch (err) { }

    setShapeStyle({
      bg: element.style.backgroundColor || '#3b82f6',
      border: element.style.borderColor || '#ffffff',
      thickness: parseInt(element.classList.contains('shape-line') ? element.style.height : element.style.borderWidth) || 2,
      rotation: rot < 0 ? rot + 360 : rot,
      width: parseInt(element.style.width) || element.offsetWidth,
      left: parseInt(element.style.left) || 0,
      top: parseInt(element.style.top) || 0
    });

    // 1b. Lengüeta de movimiento del cuadro de texto (handle-move, barra superior
    //     central). Arrastrarla desplaza el cuadro sin entrar en modo edición (la
    //     lengüeta es contenteditable=false y está fuera del área de texto). Se
    //     comprueba ANTES que la lógica de redimensión porque la lengüeta queda a
    //     top:-10px => clickY < 0 => el margen de 35px la detectaría como esquina.
    if (target.classList.contains('handle-move')) {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingShape(true);
      const initialLeft = parseInt(element.style.left) || 0;
      const initialTop = parseInt(element.style.top) || 0;
      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const handleMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startMouseX;
        const dy = moveEvent.clientY - startMouseY;
        element.style.left = `${initialLeft + dx}px`;
        element.style.top = `${initialTop + dy}px`;
      };
      const handleUp = () => {
        setIsDraggingShape(false);
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        setShapeStyle(prev => ({
          ...prev,
          left: parseInt(element.style.left) || 0,
          top: parseInt(element.style.top) || 0
        }));
        handleContentChange(editorRef.current?.innerHTML || '');
      };
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
      return;
    }

    // 2. LÓGICA DE REDIMENSIÓN (Prioridad si es un tirador o clic en esquina)
    const margin = 35;
    const isNearCorner = clickX < margin || clickX > rect.width - margin || clickY < margin || clickY > rect.height - margin;

    if (isHandle || (isNearCorner && !element.classList.contains('shape-line'))) {
      e.preventDefault();
      e.stopPropagation();

      let handleType = isHandle ? target.className.split(' ').find(c => c.startsWith('handle-')) : null;
      if (!handleType) {
        if (clickX < margin && clickY < margin) handleType = 'handle-nw';
        else if (clickX > rect.width - margin && clickY < margin) handleType = 'handle-ne';
        else if (clickX < margin && clickY > rect.height - margin) handleType = 'handle-sw';
        else handleType = 'handle-se';
      }

      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = parseInt(element.style.left) || 0;
      const startTop = parseInt(element.style.top) || 0;
      const startWidth = parseInt(element.style.width) || element.offsetWidth;
      const startHeight = parseInt(element.style.height) || element.offsetHeight;

      const handleResizeMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (handleType === 'handle-se') {
          element.style.width = `${Math.max(10, startWidth + dx)}px`;
          element.style.height = `${Math.max(10, startHeight + dy)}px`;
        } else if (handleType === 'handle-sw') {
          element.style.width = `${Math.max(10, startWidth - dx)}px`;
          element.style.height = `${Math.max(10, startHeight + dy)}px`;
          element.style.left = `${startLeft + dx}px`;
        } else if (handleType === 'handle-ne') {
          element.style.width = `${Math.max(10, startWidth + dx)}px`;
          element.style.height = `${Math.max(10, startHeight - dy)}px`;
          element.style.top = `${startTop + dy}px`;
        } else if (handleType === 'handle-nw') {
          element.style.width = `${Math.max(10, startWidth - dx)}px`;
          element.style.height = `${Math.max(10, startHeight - dy)}px`;
          element.style.left = `${startLeft + dx}px`;
          element.style.top = `${startTop + dy}px`;
        }
      };

      const handleResizeUp = () => {
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeUp);
        // Sincronizar los sliders de Propiedades de Forma con el resultado del
        // resize (ancho/posición pueden cambiar al arrastrar esquinas nw/sw/ne).
        setShapeStyle(prev => ({
          ...prev,
          width: parseInt(element.style.width) || prev.width,
          thickness: parseInt(element.classList.contains('shape-line') ? element.style.height : element.style.borderWidth) || prev.thickness,
          left: parseInt(element.style.left) || 0,
          top: parseInt(element.style.top) || 0
        }));
        handleContentChange(editorRef.current?.innerHTML || '');
      };
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeUp);
      return;
    }

    // 3. Cuadro de texto: al hacer clic en el cuerpo (no en tirador/esquina)
    //    dejamos que el navegador coloque el caret para editar texto. NO hacemos
    //    preventDefault (que cancelaba el caret) ni iniciamos arrastre de movimiento
    //    —mover y redimensionar se hace con los tiradores de las esquinas. Sin esto,
    //    el cuadro pierde el foco al clicar dentro y el Enter se va al editor principal.
    if (element.classList.contains('shape-textbox')) {
      return;
    }

    // 4. LÓGICA DE MOVIMIENTO
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingShape(true);
    const initialLeft = parseInt(element.style.left) || 0;
    const initialTop = parseInt(element.style.top) || 0;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;

    const handleMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startMouseX;
      const dy = moveEvent.clientY - startMouseY;
      element.style.left = `${initialLeft + dx}px`;
      element.style.top = `${initialTop + dy}px`;
    };

    const handleUp = () => {
      setIsDraggingShape(false);
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      setShapeStyle(prev => ({
        ...prev,
        left: parseInt(element.style.left) || 0,
        top: parseInt(element.style.top) || 0
      }));
      handleContentChange(editorRef.current?.innerHTML || '');
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  };

  const insertRectangle = () => {
    const id = `shape-${Date.now()}`;
    editorRef.current?.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));

    const html = `<div id="${id}" class="shape-rect is-selected" contenteditable="false" style="position:absolute; top:100px; left:100px; width:200px; height:150px; background-color:${shapeStyle.bg}; border:${shapeStyle.thickness}px solid ${shapeStyle.border}; overflow:visible; border-radius:4px; cursor:move; z-index:10; transform: rotate(${shapeStyle.rotation}deg); resize:both;">
      <div class="resize-handle handle-nw" contenteditable="false"></div>
      <div class="resize-handle handle-ne" contenteditable="false"></div>
      <div class="resize-handle handle-sw" contenteditable="false"></div>
      <div class="resize-handle handle-se" contenteditable="false"></div>
    </div>`;

    if (editorRef.current) {
      editorRef.current.insertAdjacentHTML('beforeend', html);
      const el = document.getElementById(id);
      if (el) {
        setSelectedElement(el);
        (el as any).onmousedown = (e: any) => handleShapeMouseDown(e, el);
      }
      handleContentChange(editorRef.current.innerHTML);
    }
  };

  const updateShapeStyle = (updates: Partial<typeof shapeStyle>) => {
    const newStyle = { ...shapeStyle, ...updates };
    setShapeStyle(newStyle);
    if (selectedElement) {
      if (selectedElement.classList.contains('shape-rect') || selectedElement.classList.contains('shape-textbox')) {
        if (updates.bg) selectedElement.style.backgroundColor = updates.bg;
        if (updates.border) selectedElement.style.borderColor = updates.border;
        if (updates.thickness) selectedElement.style.borderWidth = `${updates.thickness}px`;
        if (updates.width) selectedElement.style.width = `${updates.width}px`;
      } else if (selectedElement.classList.contains('shape-line')) {
        if (updates.bg) selectedElement.style.backgroundColor = updates.bg;
        if (updates.thickness) selectedElement.style.height = `${updates.thickness}px`;
        if (updates.width) selectedElement.style.width = `${updates.width}px`;
      }
      if (updates.rotation !== undefined) {
        selectedElement.style.transform = `rotate(${updates.rotation}deg)`;
      }
      if (updates.left !== undefined) {
        selectedElement.style.left = `${updates.left}px`;
      }
      if (updates.top !== undefined) {
        selectedElement.style.top = `${updates.top}px`;
      }
      handleContentChange(editorRef.current?.innerHTML || '');
    }
  };

  const handleFilesSelected = (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    const url = URL.createObjectURL(file);

    if (file.type === 'application/pdf') {
      setCurrentDocumentUrl(url);
      setCurrentFileName(file.name);
      setIsUploaderOpen(false);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        let text = e.target?.result as string;

        // Si es un archivo de texto plano (.txt, .md, etc.)
        if (!file.type.includes('html')) {
          // 1. Escapar caracteres HTML para que no se pierdan (ej: < > &)
          const tempDiv = document.createElement('div');
          tempDiv.textContent = text;
          text = tempDiv.innerHTML;

          // 2. Convertir saltos de línea en <br> para que el editor los respete
          text = text.replace(/\n/g, '<br>');
        }

        // Resetear a un documento de una sola página con el nuevo contenido
        setPages([text]);
        setCurrentPageIndex(0);
        if (editorRef.current) editorRef.current.innerHTML = text;
        setHtmlContent(text);

        setCurrentFileName(file.name);
        setCurrentDocumentUrl('');
        setIsUploaderOpen(false);
      };
      reader.readAsText(file);
    }
  };

  const DOC_EXT = ['txt', 'pdf', 'md', 'html', 'htm', 'doc', 'docx'];
  const isDocumentFileAllowed = (fileName: string) => DOC_EXT.includes((fileName.split('.').pop() || '').toLowerCase());

  const openLocalDocumentFolder = async () => {
    setPbLoading(true);
    setLoadType('local');
    setPbLoadStep('local');
    setLocalFolderFiles([]);
    setIsUploaderOpen(true);

    try {
      const userId = pb.authStore.model?.id;
      if (!userId) {
        alert(t('editorHTML.docEditor.errNotAuthed'));
        setIsUploaderOpen(false);
        return;
      }

      const paths = await getLocalPaths();
      const folder = paths?.documentos;

      if (!folder) {
        alert(t('editorHTML.docEditor.errNoDocsFolder'));
        setIsUploaderOpen(false);
        return;
      }

      const files = await listDirectory(folder);
      setLocalFolderFiles(files || []);
    } catch (error: any) {
      console.error(error);
      alert(t('editorHTML.docEditor.errAccessFiles'));
      setIsUploaderOpen(false);
    } finally {
      setPbLoading(false);
    }
  };

  const openLocalProjectsFolder = async () => {
    setPbLoading(true);
    setLoadType('proyectos');
    setSavedProjects([]);
    setIsLoadModalOpen(true);

    try {
      const paths = await getLocalPaths();
      const folder = paths?.proyectos_documentos || paths?.proyectos;

      if (!folder) {
        alert(t('editorHTML.docEditor.errNoProjectsFolder'));
        setIsLoadModalOpen(false);
        return;
      }

      const files = await listDirectory(folder);
      const projects = (files || []).map((f: any) => ({
        id: f.path,
        titulo: f.name || f.fileName,
        path: f.path,
        isDirectory: f.isDirectory,
        isLocal: true
      }));
      setSavedProjects(projects);
    } catch (error: any) {
      console.error(error);
      alert(t('editorHTML.docEditor.errAccessProjects'));
      setIsLoadModalOpen(false);
    } finally {
      setPbLoading(false);
    }
  };

  const handleOpenLocalProject = async (p: any) => {
    setPbLoading(true);
    try {
      let projectPath = p.path;
      if (p.isDirectory) {
        const files = await listDirectory(p.path);
        const zeusFile = files.find((f: any) => f.name.endsWith('.zeus'));
        if (zeusFile) projectPath = zeusFile.path;
        else throw new Error(t('editorHTML.docEditor.errNoZeusFile'));
      }

      const projectData = await readProject(projectPath);
      if (!projectData) throw new Error(t('editorHTML.docEditor.errReadProject'));

      const data = projectData.file || projectData;
      if (data.pages) {
        setPages(data.pages);
        setMargins(data.margins || { left: 48, right: 48 });
        setSelectedFormat(data.format || 'A4');
        setCurrentPageIndex(0);
        setHtmlContent(data.pages[0] || '');
        if (editorRef.current) editorRef.current.innerHTML = data.pages[0] || '';

        // GUARDAR RUTA PARA PERMITIR GUARDADO RÁPIDO
        setCurrentLocalPath(projectPath);
        setCurrentFileName(p.titulo || p.name);

        setIsLoadModalOpen(false);
      }
    } catch (e: any) {
      alert(e.message || t('editorHTML.docEditor.errOpenLocal'));
    } finally {
      setPbLoading(false);
    }
  };

  const saveProjectLocal = async (title: string) => {
    setIsSavingProject(true);
    try {
      const paths = await getLocalPaths();
      const folder = paths?.proyectos_documentos || paths?.proyectos;

      if (!folder) throw new Error(t('editorHTML.docEditor.errConfigureProjectsFirst'));

      const currentHTML = editorRef.current?.innerHTML || '';
      const updatedPages = [...pages];
      updatedPages[currentPageIndex] = currentHTML;

      const projectData = {
        pages: updatedPages,
        margins,
        format: selectedFormat,
        version: '1.0'
      };

      await ensureDir(folder);
      const projectPath = `${folder}\\${title}.zeus`;
      const saved = await saveProject(projectPath, {
        titulo: title,
        tipo: 'edit_documento',
        file: projectData
      });

      if (!saved) throw new Error(t('editorHTML.docEditor.errSaveLocal'));

      // REGISTRAR RUTA PARA FUTUROS GUARDADOS RÁPIDOS
      setCurrentLocalPath(projectPath);
      setCurrentFileName(`${title}.zeus`);

      alert(t('editorHTML.docEditor.savedProjectLocal', { name: title }));
      setIsSaveModalOpen(false);
    } catch (e: any) {
      alert(e.message || t('editorHTML.docEditor.errSaveProject'));
    } finally {
      setIsSavingProject(false);
    }
  };

  const openLoadFromPocketBase = () => {
    setFileNotAllowedMessage(null);
    setPbLoadStep('collection');
    setSelectedPbCollection(null);
    setPbRecords([]);
    setSelectedPbRecordFiles(null);
    setPbLoading(true);
    setIsUploaderOpen(true);
    const fallback = [
      { id: 'documentos', name: 'documentos' },
      { id: 'imagen', name: 'imagen' },
      { id: 'video', name: 'video' },
    ];
    fetch('/api/collections')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('API no disponible'))))
      .then((data) => {
        const items = Array.isArray(data?.items) ? data.items : [];
        if (items.length > 0) {
          setPbCollections(items.map((c: any) => ({ id: c.id || c.name, name: c.name })));
          return;
        }
        return Promise.reject(new Error('Sin colecciones'));
      })
      .catch(async () => {
        try {
          if (pb.authStore.isValid) {
            const all = await pb.collections.getFullList();
            const filtered = all.filter(
              (c: { type?: string; name?: string }) =>
                c.type === 'base' && !['users', 'proyectos', 'notificaciones', 'logs'].includes(c.name || '')
            );
            if (filtered.length > 0) {
              setPbCollections(filtered.map((c: { id: string; name: string }) => ({ id: c.id || c.name, name: c.name })));
              return;
            }
          }
        } catch {
          /* sigue al fallback */
        }
        setPbCollections(fallback);
      })
      .finally(() => setPbLoading(false));
  };

  const fetchPbRecordsForCollection = (collectionName: string) => {
    setPbLoading(true);
    setSelectedPbCollection(collectionName);
    pb.collection(collectionName)
      .getFullList({ sort: '-created' })
      .then((records: any[]) => {
        const out: { recordId: string; recordName: string; files: { url: string; fileName: string }[] }[] = [];
        for (const record of records) {
          const fileFields = Object.keys(record)
            .filter((k) => {
              const v = record[k];
              if (!v) return false;
              if (typeof v === 'string' && v.includes('.')) return true;
              if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'string') return true;
              return false;
            })
            .filter((k) => !['id', 'collectionId', 'collectionName', 'created', 'updated'].includes(k));
          const files: { url: string; fileName: string }[] = [];
          for (const fieldName of fileFields) {
            const fileValue = record[fieldName];
            const list = Array.isArray(fileValue) ? fileValue : [fileValue];
            for (const file of list) {
              if (typeof file !== 'string' || !file.includes('.')) continue;
              const ext = (file.split('.').pop() || '').toLowerCase();
              if (!DOC_EXT.includes(ext)) continue;
              files.push({ url: pb.files.getURL(record, file), fileName: file });
            }
          }
          if (files.length > 0) {
            out.push({
              recordId: record.id,
              recordName: record.titulo || record.name || record.id,
              files,
            });
          }
        }
        setPbRecords(out);
        setPbLoadStep('record');
      })
      .catch((e) => console.error(e))
      .finally(() => setPbLoading(false));
  };

  const selectPbRecordForFiles = (record: { recordId: string; recordName: string; files: { url: string; fileName: string }[] }) => {
    setSelectedPbRecordFiles(record.files);
    setPbLoadStep('file');
  };

  const addOneDocumentFromPb = (item: { url: string; fileName: string }) => {
    if (!isDocumentFileAllowed(item.fileName)) {
      setFileNotAllowedMessage('Archivo no permitido');
      return;
    }
    setFileNotAllowedMessage(null);
    const fileUrl = resolveUrl(item.url);
    const ext = (item.fileName.split('.').pop() || '').toLowerCase();

    if (ext === 'pdf') {
      setCurrentDocumentUrl(fileUrl);
      setCurrentFileName(cleanDisplayFileName(item.fileName));
      setIsUploaderOpen(false);
      setPbLoadStep('collection');
      setSelectedPbRecordFiles(null);
      setSelectedPbCollection(null);
      return;
    }

    fetch(fileUrl)
      .then((res) => res.text())
      .then((text) => {
        let processed = text;
        if (!item.fileName.toLowerCase().endsWith('.html') && !item.fileName.toLowerCase().endsWith('.htm')) {
          const tempDiv = document.createElement('div');
          tempDiv.textContent = text;
          processed = tempDiv.innerHTML.replace(/\n/g, '<br>');
        }
        setPages([processed]);
        setCurrentPageIndex(0);
        if (editorRef.current) editorRef.current.innerHTML = processed;
        setHtmlContent(processed);
        setCurrentFileName(cleanDisplayFileName(item.fileName));
        setCurrentDocumentUrl('');
        setIsUploaderOpen(false);
        setPbLoadStep('collection');
        setSelectedPbRecordFiles(null);
        setSelectedPbCollection(null);
      })
      .catch((e) => {
        console.error(e);
        setFileNotAllowedMessage(t('editorHTML.docEditor.errLoadFile'));
      });
  };

  const handleContentChange = (newHtml: string) => {
    setHtmlContent(newHtml);

    // Actualizar el contenido de la página actual en el array de páginas
    const updatedPages = [...pages];
    updatedPages[currentPageIndex] = newHtml;
    setPages(updatedPages);

    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newHtml);
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };
  handleContentChangeRef.current = handleContentChange;

  const addNewPage = () => {
    // 1. Guardar contenido de la página actual antes de cambiar
    const currentHTML = editorRef.current?.innerHTML || '';
    const updatedPages = [...pages];
    updatedPages[currentPageIndex] = currentHTML;

    // 2. Añadir nueva página y saltar a ella
    const finalPages = [...updatedPages, ''];
    setPages(finalPages);
    setCurrentPageIndex(finalPages.length - 1);
    setHtmlContent('');
    if (editorRef.current) editorRef.current.innerHTML = '';
  };

  const goToPage = (index: number) => {
    if (index === currentPageIndex) return;

    // 1. Guardar contenido de la página actual antes de salir
    const currentHTML = editorRef.current?.innerHTML || '';
    const updatedPages = [...pages];
    updatedPages[currentPageIndex] = currentHTML;

    // 2. Cargar el contenido de la página destino
    const targetContent = updatedPages[index] || '';

    setPages(updatedPages);
    setCurrentPageIndex(index);
    setHtmlContent(targetContent);
    if (editorRef.current) editorRef.current.innerHTML = targetContent;
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const prevContent = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      if (editorRef.current) editorRef.current.innerHTML = prevContent;
      setHtmlContent(prevContent);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const nextContent = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      if (editorRef.current) editorRef.current.innerHTML = nextContent;
      setHtmlContent(nextContent);
    }
  };

  const handleCopy = async () => {
    try {
      const text = editorRef.current?.innerText || '';
      const ok = await copyText(text);
      if (!ok) throw Object.assign(new Error('Permiso denegado'), { name: 'NotAllowedError' });
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      const msg = err instanceof Error && err.name === 'NotAllowedError'
        ? 'Permiso denegado: haz clic en la ventana antes de copiar.'
        : 'No se pudo copiar al portapapeles.';
      console.warn(msg, err);
    }
  };

  const handleExportDocument = async () => {
    setIsExporting(true);
    console.log(`🎬 Exportando "${exportConfig.title}" a la colección de Documentos...`);

    try {
      // Creamos el contenido del documento. Para máxima compatibilidad con tu PB,
      // lo enviamos como un PDF si es posible, o un .doc bien formado.
      const blob = new Blob([htmlContent], { type: 'application/pdf' });
      const fileName = `${exportConfig.title}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });

      const formData = new FormData();
      formData.append('titulo', exportConfig.title);
      formData.append('file', file);

      // Intentar crear el registro
      await pb.collection('documentos').create(formData);

      alert(t('editorHTML.docEditor.exportOk', { name: fileName }));
      setIsExportModalOpen(false);
    } catch (error: any) {
      console.error('❌ Error detallado de PocketBase:', error.data);
      alert(t('editorHTML.docEditor.exportError', { msg: error.message }));
    } finally {
      setIsExporting(false);
    }
  };

  const saveProjectToPocketBase = async (title: string) => {
    setIsSavingProject(true);
    console.log('🚀 Guardando como texto enriquecido directamente...');

    try {
      // 1. Sincronizar página actual
      const currentHTML = editorRef.current?.innerHTML || '';
      const updatedPages = [...pages];
      updatedPages[currentPageIndex] = currentHTML;
      setPages(updatedPages);

      // 2. Construir el objeto de metadatos y contenido
      const projectData = {
        pages: updatedPages,
        margins,
        format: selectedFormat
      };

      const formData = new FormData();
      formData.append('titulo', title);
      formData.append('tipo', 'edit_documento');
      // Enviamos el JSON del proyecto al campo file_text_rich (que es tipo editor/texto)
      formData.append('file_text_rich', JSON.stringify(projectData));

      const record = await pb.collection('proyectos').create(formData);

      setIsSaveModalOpen(false);
      alert(t('editorHTML.docEditor.savedRichText'));
    } catch (error) {
      console.error(error);
      alert(t('editorHTML.docEditor.errSaveRichText'));
    } finally {
      setIsSavingProject(false);
    }
  };

  const fetchProjectsFromPocketBase = async () => {
    setIsLoadingProjects(true);
    try {
      const records = await pb.collection('proyectos').getFullList({
        filter: "tipo = 'edit_documento'",
        sort: '-created'
      });
      setSavedProjects(records);
      setIsLoadModalOpen(true);
    } catch (error) { console.error(error); } finally { setIsLoadingProjects(false); }
  };

  const loadProjectFromRecord = async (project: any) => {
    try {
      // Prioridad 1: Cargar desde file_text_rich (tipo editor/string)
      if (project.file_text_rich) {
        let data: any = null;
        let isJson = false;

        // Intentar parsear como JSON directo (formato nuevo)
        try {
          data = JSON.parse(project.file_text_rich);
          if (data && data.pages) isJson = true;
        } catch (e) {
          // No es JSON directo, podría ser un nombre de archivo o HTML plano
        }

        if (isJson) {
          console.log('📦 Cargando proyecto desde JSON directo');
          setPages(data.pages);
          setMargins(data.margins || { left: 48, right: 48 });
          setSelectedFormat(data.format || 'A4');
          setCurrentPageIndex(0);
          setHtmlContent(data.pages[0] || '');
          if (editorRef.current) editorRef.current.innerHTML = data.pages[0] || '';
          setIsLoadModalOpen(false);
          return;
        }

        // Si no es JSON, intentar cargar como archivo (formato antiguo)
        console.log('🌐 Intentando descargar desde URL de archivo');
        try {
          const url = pb.files.getURL(project, project.file_text_rich);
          const response = await fetch(url);
          if (response.ok) {
            const html = await response.text();

            // Extraer Metadatos
            const metaMatch = html.match(/<!-- Zeus_METADATA: (.*?) -->/);
            if (metaMatch) {
              const meta = JSON.parse(metaMatch[1]);
              setMargins(meta.margins || { left: 48, right: 48 });
              setSelectedFormat(meta.format || 'A4');
            }

            // Extraer Páginas
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            const pageSections = tempDiv.querySelectorAll('section.Zeus-page');

            if (pageSections.length > 0) {
              const loadedPages = Array.from(pageSections).map(s => s.innerHTML);
              setPages(loadedPages);
              setCurrentPageIndex(0);
              setHtmlContent(loadedPages[0]);
              if (editorRef.current) editorRef.current.innerHTML = loadedPages[0];
            } else {
              setPages([html]);
              setCurrentPageIndex(0);
              setHtmlContent(html);
              if (editorRef.current) editorRef.current.innerHTML = html;
            }
            setIsLoadModalOpen(false);
            return;
          }
        } catch (e) {
          console.warn('Fallo al cargar como archivo, intentando como HTML plano');
        }

        // Si todo falla, cargar como HTML plano
        setPages([project.file_text_rich]);
        setCurrentPageIndex(0);
        setHtmlContent(project.file_text_rich);
        if (editorRef.current) editorRef.current.innerHTML = project.file_text_rich;
      }
      // Prioridad 2: Cargar desde JSON (campo file antiguo)
      else if (project.file) {
        const data = typeof project.file === 'string' ? JSON.parse(project.file) : project.file;
        if (data.pages) {
          setPages(data.pages);
          setMargins(data.margins || { left: 48, right: 48 });
          setSelectedFormat(data.format || 'A4');
          setCurrentPageIndex(0);
          const firstPage = data.pages[0] || '';
          if (editorRef.current) editorRef.current.innerHTML = firstPage;
          setHtmlContent(firstPage);
        } else if (data.content !== undefined) {
          setPages([data.content]);
          setCurrentPageIndex(0);
          if (editorRef.current) editorRef.current.innerHTML = data.content;
          setHtmlContent(data.content);
        }
      }

      setIsLoadModalOpen(false);
    } catch (e) {
      console.error("Error cargando proyecto:", e);
      alert(t('editorHTML.docEditor.errLoadFile'));
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-gray-950 text-white overflow-hidden shadow-2xl"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpPaper}
      onMouseLeave={handleMouseUpPaper}
    >
      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar { width: 16px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255, 255, 255, 0.03); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 10px; min-height: 40px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.35); }
        .editor-content:focus { outline: none; }
        .editor-content h1 { font-size: 2em; font-weight: bold; }
        .editor-content h2 { font-size: 1.5em; font-weight: bold; }
        .editor-content :global(ul) {
          list-style-type: disc !important;
          list-style-position: inside !important;
          padding-left: 10px !important;
          margin: 10px 0;
        }
        .editor-content :global(ol) {
          list-style-type: decimal !important;
          list-style-position: inside !important;
          padding-left: 10px !important;
          margin: 10px 0;
        }
        .editor-content :global(li) {
          display: list-item !important;
          color: inherit;
          margin-bottom: 4px;
        }
        .img-wrapper {
          border: 2px solid transparent;
          transition: border-color 0.2s;
        }
        .img-wrapper:hover {
          border-color: #3b82f6;
          background: rgba(59, 130, 246, 0.1);
        }
        /* Imagen seleccionada (clic sobre ella) para los botones de alineación.
           :global porque .img-wrapper se inserta por DOM (execCommand/insertHTML)
           y no lleva la clase de scoping de styled-jsx. */
        .editor-content :global(.img-wrapper.is-selected) {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
        }
        /* Forzar visibilidad del tirador nativo de redimensionamiento */
        .img-wrapper::-webkit-resizer {
          background-color: #3b82f6;
          border-radius: 5px;
        }
        .editor-content.show-textbox-guide :global(.shape-textbox:hover),
        .editor-content.show-textbox-guide :global(.shape-textbox:focus) {
          outline: 1px dashed rgba(255,255,255,0.3) !important;
        }
        /* Guía de cuadro de texto: borde gris flojito discontinuo visible solo en
           el editor. Es una regla CSS (no inline) => no viaja al HTML/PDF exportado
           (que serializa innerHTML sin esta hoja de estilos). En window.print() se
           oculta con @media print. Un borde explícito puesto desde el panel es
           inline => tiene prioridad y sí se imprime. Se ventila detrás de la clase
           .show-textbox-guide (toggle del panel) para poder ocultarla por completo. */
        .editor-content.show-textbox-guide :global(.shape-textbox) {
          border: 1px dashed rgba(170, 170, 170, 0.55);
          border-radius: 3px;
        }
        @media print {
          .editor-content :global(.shape-textbox) {
            border: none;
          }
        }
        /* Línea: ampliar el área de click. La línea es muy fina (height = grosor)
           y el box-shadow transparente NO cuenta para hit-testing, así que tras
           deseleccionarla no se podía volver a clicar. Un ::before transparente
           de ~8px alrededor SÍ es hit-testable => clicar cerca selecciona la línea. */
        .editor-content :global(.shape-line)::before {
          content: '';
          position: absolute;
          inset: -8px;
          background: transparent;
        }
        /* Tiradores de redimensión Profesionales */
        .resize-handle {
          width: 20px !important;
          height: 20px !important;
          background-color: transparent !important;
          position: absolute !important;
          z-index: 9999 !important;
          display: none;
          pointer-events: auto !important;
        }
        .resize-handle::after {
          content: '';
          position: absolute;
          top: 5px;
          left: 5px;
          width: 10px;
          height: 10px;
          background-color: #eab308;
          border: 2px solid #000;
          border-radius: 2px;
          box-shadow: 0 0 5px rgba(0,0,0,0.5);
        }
        .is-selected > .resize-handle {
          display: block !important;
        }
        .handle-nw { top: -10px; left: -10px; cursor: nw-resize; }
        .handle-ne { top: -10px; right: -10px; cursor: ne-resize; }
        .handle-sw { bottom: -10px; left: -10px; cursor: sw-resize; }
        .handle-se { bottom: -10px; right: -10px; cursor: se-resize; }

        /* Lengüeta de movimiento del cuadro de texto: barra azul superior central.
           contenteditable=false (no entra en edición), fuera del área de texto
           (top:-10px). Sólo visible cuando el cuadro está seleccionado, como los
           tiradores. Arrastrarla desplaza el cuadro. */
        .editor-content :global(.handle-move) {
          width: 26px !important;
          height: 14px !important;
          position: absolute !important;
          top: -11px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 9999 !important;
          display: none;
          pointer-events: auto !important;
          cursor: move;
          background-color: #3b82f6 !important;
          border: 2px solid #000;
          border-radius: 4px;
          box-shadow: 0 0 5px rgba(0,0,0,0.5);
        }
        .editor-content :global(.is-selected) > .handle-move {
          display: block !important;
        }

        .is-selected {
          outline: 2px solid #eab308 !important;
          z-index: 50 !important;
        }
      `}</style>

      {/* Header Pro */}
      <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center px-4 shrink-0 gap-4">
        <div className="flex-1 min-w-0" />
        <div className="flex shrink-0 justify-center">
          <EditorFileNameBar
            items={[currentFileName || 'Sin título']}
            icon={isPdf ? <FileText className="w-4 h-4" /> : <FileCode className="w-4 h-4" />}
            colorClass="text-yellow-400"
            className="w-full max-w-md xl:max-w-xl"
          />
        </div>
        <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-[10px] font-medium text-white border border-emerald-400/50 bg-gradient-to-b from-white/15 to-transparent hover:bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)] transition-all"
              >
                <FileText className="w-4 h-4 mr-2 text-emerald-400" />
                {t('editorHTML.docEditor.template')}
                <span className="ml-2 text-emerald-300 font-black">{t('editorHTML.docEditor.choose')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-gray-900 border-gray-800 text-white min-w-[180px]">
              {TEMPLATES.map((tpl) => (
                <DropdownMenuItem
                  key={tpl.id}
                  onClick={() => {
                    if (editorRef.current) {
                      editorRef.current.innerHTML = tpl.html;
                      handleContentChange(tpl.html);
                    }
                  }}
                  className="hover:bg-gray-800 cursor-pointer"
                >
                  {t('editorHTML.docEditor.' + tpl.label)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-6 bg-gray-800 mx-1" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-[10px] font-medium text-white border border-yellow-400/50 bg-gradient-to-b from-white/15 to-transparent hover:bg-yellow-500/20 shadow-[0_0_10px_rgba(234,179,8,0.2)] transition-all"
              >
                <FileText className="w-4 h-4 mr-2 text-yellow-400" />
                {t('editorHTML.docEditor.format')}
                <span className="ml-2 text-green-400 font-black">{selectedFormat}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-gray-900 border-gray-800 text-white min-w-[120px]">
              <DropdownMenuItem onClick={() => {
                setSelectedFormat('A3');
                onFormatChange?.('A3');
              }} className="hover:bg-gray-800 cursor-pointer">
                DIN A3
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                setSelectedFormat('A4');
                onFormatChange?.('A4');
              }} className="hover:bg-gray-800 cursor-pointer">
                DIN A4
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                setSelectedFormat('A5');
                onFormatChange?.('A5');
              }} className="hover:bg-gray-800 cursor-pointer">
                DIN A5
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                setSelectedFormat('Letter');
                onFormatChange?.('Letter');
              }} className="hover:bg-gray-800 cursor-pointer">
                Letter
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                setSelectedFormat('Legal');
                onFormatChange?.('Legal');
              }} className="hover:bg-gray-800 cursor-pointer">
                Legal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-6 bg-gray-800 mx-1" />

          {!isPdf && (
            <>
              <Button
                variant="ghost"
                size="sm"
                tabIndex={-1}
                onClick={(e) => {
                  e.preventDefault();
                  handleUndo();
                }}
                disabled={historyIndex === 0}
                className="h-9 w-9 p-0 text-white border border-yellow-400 bg-gradient-to-b from-white/20 to-transparent hover:bg-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.3)] hover:shadow-[0_0_20px_rgba(234,179,8,0.5)] disabled:opacity-20 transition-all"
              >
                <Undo className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                tabIndex={-1}
                onClick={(e) => {
                  e.preventDefault();
                  handleRedo();
                }}
                disabled={historyIndex === history.length - 1}
                className="h-9 w-9 p-0 text-white border border-yellow-400 bg-gradient-to-b from-white/20 to-transparent hover:bg-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.3)] hover:shadow-[0_0_20px_rgba(234,179,8,0.5)] disabled:opacity-20 transition-all mx-1"
              >
                <Redo className="w-5 h-5" />
              </Button>
              <div className="w-px h-6 bg-gray-800 mx-1" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[10px] font-medium text-white border border-yellow-400/50 bg-gradient-to-b from-white/15 to-transparent hover:bg-yellow-500/20 shadow-[0_0_10px_rgba(234,179,8,0.2)] transition-all"
                  >
                    <FolderOpen className="w-4 h-4 mr-2 text-yellow-400" />
                    {t('editorHTML.docEditor.load')}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-gray-900 border-gray-800 text-white min-w-[200px]">
                  <DropdownMenuItem onClick={() => openLocalProjectsFolder()} className="hover:bg-gray-800 cursor-pointer flex gap-2 font-bold text-blue-400">
                    <Folder className="w-4 h-4 mr-2" /> {t('editorHTML.docEditor.loadLocalProject')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openLocalDocumentFolder()} className="hover:bg-gray-800 cursor-pointer flex gap-2 font-bold text-yellow-400">
                    <Upload className="w-4 h-4 mr-2" /> {t('editorHTML.docEditor.loadLocalFileTitle')}
                  </DropdownMenuItem>
                  <div className="h-px bg-gray-800 my-1" />
                  <DropdownMenuItem onClick={() => window.print()} className="hover:bg-gray-800 cursor-pointer flex gap-2 text-gray-400">
                    <Printer className="w-4 h-4 mr-2" /> {t('editorHTML.docEditor.printDoc')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Herramientas Rico (Solo para Texto) */}
        {!isPdf && (
          <div className="w-80 bg-gray-900 border-r border-gray-800 flex flex-col shrink-0">
            <Tabs value={activeSidebarTab} onValueChange={setActiveSidebarTab} className="flex-1 flex flex-col">
              <TabsList className="bg-gray-950 p-1 m-4 rounded-lg grid grid-cols-2">
                <TabsTrigger value="format" className="data-[state=active]:bg-gray-800 data-[state=active]:text-yellow-400 text-[10px] font-bold uppercase">{t('editorHTML.docEditor.tools')}</TabsTrigger>
                <TabsTrigger value="settings" className="data-[state=active]:bg-gray-800 data-[state=active]:text-yellow-400 text-[10px] font-bold uppercase">{t('editorHTML.docEditor.paragraph')}</TabsTrigger>
              </TabsList>

              <TabsContent value="format" className="p-4 space-y-6 overflow-y-auto custom-scrollbar">
                {/* Zoom del Documento */}
                <div className="space-y-3">
                  <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest flex items-center gap-2"><Maximize className="w-3.5 h-3.5" /> {t('editorHTML.docEditor.docView')}</Label>
                  <div className="flex w-full gap-1.5 items-center">
                    <Button
                      variant="ghost"
                      onClick={() => setZoom(prev => Math.max(25, prev - 10))}
                      className="flex-1 h-8 text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)]"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </Button>
                    <button
                      onClick={() => setZoom(100)}
                      className="px-3 h-8 text-[10px] font-black text-green-400 hover:text-white transition-colors"
                    >
                      {zoom}%
                    </button>
                    <Button
                      variant="ghost"
                      onClick={() => setZoom(prev => Math.min(200, prev + 10))}
                      className="flex-1 h-8 text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Estilos de Selección */}
                <div className="space-y-3">
                  <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest flex items-center gap-2"><Type className="w-3 h-3" /> {t('editorHTML.docEditor.selFormat')}</Label>
                  <div className="flex bg-gray-950 p-1 rounded-xl border border-white/5 shadow-inner">
                    <Button
                      variant="ghost"
                      size="sm"
                      onMouseDown={(e) => { e.preventDefault(); execCommand('bold'); }}
                      className={cn("flex-1 h-9 rounded-lg", activeStyles.bold && "bg-gray-800 text-yellow-400")}
                    >
                      <Bold className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onMouseDown={(e) => { e.preventDefault(); execCommand('italic'); }}
                      className={cn("flex-1 h-9 rounded-lg", activeStyles.italic && "bg-gray-800 text-yellow-400")}
                    >
                      <Italic className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onMouseDown={(e) => { e.preventDefault(); execCommand('underline'); }}
                      className={cn("flex-1 h-9 rounded-lg", activeStyles.underline && "bg-gray-800 text-yellow-400")}
                    >
                      <Underline className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {/* Color de Texto */}
                <div className="space-y-3">
                  <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest flex items-center gap-2"><Palette className="w-3 h-3" /> {t('editorHTML.docEditor.textColor')}</Label>
                  <div className="grid grid-cols-6 gap-2 p-2 bg-gray-950 rounded-xl border border-white/5">
                    {['#ffffff', '#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7'].map(color => (
                      <button
                        key={color}
                        onClick={() => execCommand('foreColor', color)}
                        className="w-full aspect-square rounded-full border border-white/10 transition-transform hover:scale-110"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* Fuentes */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest flex items-center gap-2"><Type className="w-3 h-3" /> {t('editorHTML.docEditor.typography')}</Label>
                    <button
                      type="button"
                      onClick={loadLocalFonts}
                      title={t('editorHTML.text.refreshLocalFonts')}
                      className="text-gray-500 hover:text-green-400 transition-colors"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${localFontsLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                  <select
                    onChange={async (e) => {
                      const value = e.target.value;
                      const lf = localFonts.find((f) => f.family === value);
                      if (lf) await ensureLocalFontFace(lf);
                      execCommand('fontName', value);
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs text-gray-200 outline-none"
                  >
                    <option value="Arial">Arial</option>
                    <option value="Courier New">Monospace</option>
                    <option value="Georgia">Serif</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Impact">Impact</option>
                    {localFonts.length > 0 && (
                      <optgroup label={t('editorHTML.text.localFonts')}>
                        {localFonts.map((f) => (
                          <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>{f.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  {/* Fuente de Google Fonts (igual que el editor HTML) */}
                  <div className="space-y-2">
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        value={customFont}
                        onChange={(e) => setCustomFont(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyCustomFont(); } }}
                        placeholder={t('editorHTML.docEditor.googleFontPlaceholder')}
                        className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg p-2 text-xs text-gray-200 outline-none focus:border-green-500"
                      />
                      <Button
                        variant="ghost"
                        onClick={applyCustomFont}
                        className="h-9 px-3 text-[10px] font-bold text-green-400 border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 transition-all"
                        title={t('editorHTML.docEditor.applyFontTitle')}
                      >
                        <Check className="w-3.5 h-3.5 mr-1" /> {t('editorHTML.docEditor.apply')}
                      </Button>
                    </div>
                    <Button
                      variant="ghost"
                      onClick={() => window.open('https://fonts.google.com', '_blank')}
                      className="w-full h-8 text-[10px] font-medium text-white border border-blue-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-blue-500/20 transition-all"
                      title={t('editorHTML.docEditor.openFontsTitle')}
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-2" /> {t('editorHTML.docEditor.openGoogleFonts')}
                    </Button>
                  </div>
                </div>

                {/* Insertar Imagen */}
                <div className="space-y-3">
                  <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest flex items-center gap-2"><ImageIcon className="w-3.5 h-3.5" /> Multimedia</Label>
                  <Button
                    variant="ghost"
                    className="w-full h-8 text-[10px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)] transition-all"
                    onClick={() => imageInputRef.current?.click()}
                  >
                    <ImageIcon className="w-3.5 h-3.5 mr-1" /> {t('editorHTML.docEditor.insertImage')}
                  </Button>
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageInsert}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => alignImage('left')}
                      title={t('editorHTML.docEditor.alignLeftTitle')}
                      className="flex-1 h-8 text-[10px] font-medium text-white border border-green-400/60 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20"
                    >
                      <AlignLeft className="w-3.5 h-3.5 mr-1" /> {t('editorHTML.docEditor.alignLeft')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => alignImage('center')}
                      title={t('editorHTML.docEditor.alignCenterTitle')}
                      className="flex-1 h-8 text-[10px] font-medium text-white border border-green-400/60 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20"
                    >
                      <AlignCenter className="w-3.5 h-3.5 mr-1" /> {t('editorHTML.docEditor.alignCenter')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => alignImage('right')}
                      title={t('editorHTML.docEditor.alignRightTitle')}
                      className="flex-1 h-8 text-[10px] font-medium text-white border border-green-400/60 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20"
                    >
                      <AlignRight className="w-3.5 h-3.5 mr-1" /> {t('editorHTML.docEditor.alignRight')}
                    </Button>
                  </div>
                </div>

                {/* Tamaño de Selección */}
                <div className="space-y-3">
                  <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest flex items-center gap-2"><Type className="w-3 h-3" /> {t('editorHTML.docEditor.selSize')}</Label>
                  <div className="flex w-full gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7].map(size => (
                      <button
                        key={size}
                        onMouseDown={(e) => { e.preventDefault(); execCommand('fontSize', size.toString()); }}
                        className="flex-1 h-8 flex items-center justify-center text-[10px] font-bold text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_8px_rgba(34,197,94,0.15)] rounded-lg transition-all"
                      >
                        T{size}
                      </button>
                    ))}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="settings" className="p-4 space-y-6">
                {/* Alineación */}
                <div className="space-y-3">
                  <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest">{t('editorHTML.docEditor.alignment')}</Label>
                  <div className="flex bg-gray-950 p-1 rounded-xl border border-white/5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onMouseDown={(e) => { e.preventDefault(); execCommand('justifyLeft'); }}
                      className="flex-1 h-8 text-white border border-green-400/50 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)] hover:shadow-[0_0_15px_rgba(34,197,94,0.4)] transition-all"
                    >
                      <AlignLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onMouseDown={(e) => { e.preventDefault(); execCommand('justifyCenter'); }}
                      className="flex-1 h-8 text-white border border-green-400/50 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)] hover:shadow-[0_0_15px_rgba(34,197,94,0.4)] transition-all mx-1"
                    >
                      <AlignCenter className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onMouseDown={(e) => { e.preventDefault(); execCommand('justifyRight'); }}
                      className="flex-1 h-8 text-white border border-green-400/50 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)] hover:shadow-[0_0_15px_rgba(34,197,94,0.4)] transition-all"
                    >
                      <AlignRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Objetos y Formas */}
                <div className="space-y-4 pt-4 border-t border-gray-800">
                  <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest flex items-center gap-2">
                    <Settings className="w-3 h-3" /> {t('editorHTML.docEditor.objectsShapes')}
                  </Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => setIsDrawingRectMode(!isDrawingRectMode)}
                      className={cn(
                        "h-8 text-[10px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.4)] hover:shadow-[0_0_25px_rgba(34,197,94,0.6)] transition-all",
                        isDrawingRectMode && "border-green-300 bg-green-500/30 shadow-[0_0_30px_rgba(34,197,94,0.8)]"
                      )}
                    >
                      <Square className="w-3.5 h-3.5 mr-1" /> {t('editorHTML.docEditor.shapeRect')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setIsDrawingLineMode(!isDrawingLineMode)}
                      className={cn(
                        "h-8 text-[10px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.4)] hover:shadow-[0_0_25px_rgba(34,197,94,0.6)] transition-all",
                        isDrawingLineMode && "border-green-300 bg-green-500/30 shadow-[0_0_30px_rgba(34,197,94,0.8)]"
                      )}
                    >
                      <Minus className="w-3.5 h-3.5 mr-2" /> {t('editorHTML.docEditor.shapeLine')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setIsDrawingTextMode(!isDrawingTextMode)}
                      className={cn(
                        "h-8 text-[10px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 col-span-2 shadow-[0_0_15px_rgba(34,197,94,0.4)] hover:shadow-[0_0_25px_rgba(34,197,94,0.6)] transition-all",
                        isDrawingTextMode && "border-green-300 bg-green-500/30 shadow-[0_0_30px_rgba(34,197,94,0.8)]"
                      )}
                    >
                      <Type className="w-3.5 h-3.5 mr-2" /> {t('editorHTML.docEditor.textbox')}
                    </Button>
                  </div>

                  {/* Toggle del borde discontinuo de guía de los cuadros de texto.
                      Sólo afecta a la guía CSS del editor (no al borde inline ni al
                      exportado). Por defecto activado. */}
                  <label className="flex items-center gap-2 cursor-pointer select-none group">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={showTextboxGuide}
                      onClick={() => setShowTextboxGuide(v => !v)}
                      className={cn(
                        "relative w-9 h-5 rounded-full transition-colors shrink-0",
                        showTextboxGuide ? "bg-green-500" : "bg-gray-700"
                      )}
                    >
                      <span className={cn("absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform", showTextboxGuide && "translate-x-4")} />
                    </button>
                    <span className="text-[10px] text-gray-400 group-hover:text-gray-200">
                      {t('editorHTML.docEditor.showTextboxGuide')}
                    </span>
                  </label>

                  {/* Editor de Forma (Solo si hay algo seleccionado) */}
                  <div className={cn("space-y-4 p-3 bg-gray-950 rounded-xl border border-white/5 transition-all", !selectedElement && "opacity-50 pointer-events-none")}>
                    <p className="text-[9px] font-bold text-gray-500 uppercase">{t('editorHTML.docEditor.shapeProps')}</p>

                    <div className="space-y-2">
                      <Label className="text-[9px] uppercase text-gray-500">{t('editorHTML.docEditor.fillColor')}</Label>
                      <div className="flex gap-1.5 flex-wrap">
                        {/* Opción Transparente */}
                        <button
                          onClick={() => updateShapeStyle({ bg: 'transparent' })}
                          className={cn("w-6 h-6 rounded-full border border-white/20 relative overflow-hidden bg-white/5 hover:bg-white/10", shapeStyle.bg === 'transparent' && "ring-2 ring-blue-500")}
                          title="Transparente"
                        >
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-full h-px bg-red-500/50 rotate-45" />
                          </div>
                        </button>

                        {['#3b82f6', '#ef4444', '#22c55e', '#eab308', '#ffffff', '#000000'].map(c => (
                          <button
                            key={c}
                            onClick={() => updateShapeStyle({ bg: c })}
                            className={cn("w-6 h-6 rounded-full border border-white/10", shapeStyle.bg === c && "ring-2 ring-blue-500")}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                    </div>

                    {selectedElement?.classList.contains('shape-rect') && (
                      <div className="space-y-2">
                        <Label className="text-[9px] uppercase text-gray-500">{t('editorHTML.docEditor.borderColor')}</Label>
                        <div className="flex gap-1.5 flex-wrap">
                          {['#ffffff', '#000000', '#3b82f6', '#ef4444', '#22c55e', '#eab308'].map(c => (
                            <button
                              key={c}
                              onClick={() => updateShapeStyle({ border: c })}
                              className={cn("w-6 h-6 rounded-full border border-white/10", shapeStyle.border === c && "ring-2 ring-blue-500")}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label className="text-[9px] uppercase text-gray-500 flex justify-between">
                        {t('editorHTML.docEditor.lengthWidth')} <span>{shapeStyle.width}px</span>
                      </Label>
                      <Slider
                        min={10} max={1000} step={5}
                        value={[shapeStyle.width]}
                        onValueChange={(v) => updateShapeStyle({ width: v[0] })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-[9px] uppercase text-gray-500 flex justify-between">
                        {t('editorHTML.docEditor.thicknessHeight')} <span>{shapeStyle.thickness}px</span>
                      </Label>
                      <Slider
                        min={1} max={50} step={1}
                        value={[shapeStyle.thickness]}
                        onValueChange={(v) => updateShapeStyle({ thickness: v[0] })}
                      />
                    </div>

                    {/* Posición: mueve la forma seleccionada (también el cuadro de
                        texto) sin arrastrar. Lectura/escritura de style.left/top. */}
                    <div className="space-y-2">
                      <Label className="text-[9px] uppercase text-gray-500 flex justify-between">
                        {t('editorHTML.docEditor.posX')} <span>{shapeStyle.left}px</span>
                      </Label>
                      <Slider
                        min={0} max={1200} step={1}
                        value={[shapeStyle.left]}
                        onValueChange={(v) => updateShapeStyle({ left: v[0] })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[9px] uppercase text-gray-500 flex justify-between">
                        {t('editorHTML.docEditor.posY')} <span>{shapeStyle.top}px</span>
                      </Label>
                      <Slider
                        min={0} max={1700} step={1}
                        value={[shapeStyle.top]}
                        onValueChange={(v) => updateShapeStyle({ top: v[0] })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-[9px] uppercase text-gray-500 flex justify-between">
                        {t('editorHTML.docEditor.rotation')} <span>{shapeStyle.rotation}°</span>
                      </Label>
                      <Slider
                        min={0} max={360} step={1}
                        value={[shapeStyle.rotation]}
                        onValueChange={(v) => updateShapeStyle({ rotation: v[0] })}
                      />
                      <div className="flex gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateShapeStyle({ rotation: 0 })}
                          className="flex-1 h-7 text-[9px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)]"
                        >
                          0°
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateShapeStyle({ rotation: 45 })}
                          className="flex-1 h-7 text-[9px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)]"
                        >
                          45°
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateShapeStyle({ rotation: 90 })}
                          className="flex-1 h-7 text-[9px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_10px_rgba(34,197,94,0.2)]"
                        >
                          90°
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-gray-800">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (selectedElement) {
                            selectedElement.remove();
                            setSelectedElement(null);
                            handleContentChange(editorRef.current?.innerHTML || '');
                          }
                        }}
                        className="w-full h-10 text-[10px] uppercase font-black text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20"
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> {t('editorHTML.docEditor.deleteObject')}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-gray-800">
                  <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest flex items-center gap-2">
                    <FileText className="w-3 h-3" /> {t('editorHTML.docEditor.pageNav')}
                  </Label>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onClick={addNewPage}
                      className="flex-1 h-8 text-[10px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.4)] hover:shadow-[0_0_25px_rgba(34,197,94,0.6)]"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> {t('editorHTML.docEditor.newPage')}
                    </Button>
                    <select
                      value={currentPageIndex}
                      onChange={(e) => goToPage(parseInt(e.target.value))}
                      className="w-24 h-8 bg-gray-950 border border-green-400 rounded-lg p-1 text-[10px] font-bold text-white outline-none cursor-pointer hover:bg-green-500/10 transition-all shadow-[0_0_15px_rgba(34,197,94,0.3)]"
                    >
                      {pages.map((_, i) => (
                        <option key={i} value={i} className="bg-gray-900">{t('editorHTML.docEditor.pageShort')} {i + 1}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Listas */}
                <div className="space-y-3">
                  <Label className="text-[10px] font-black uppercase text-gray-500 tracking-widest">{t('editorHTML.docEditor.lists')}</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      onMouseDown={(e) => { e.preventDefault(); toggleList('ul'); }}
                      className={cn("flex-1 h-8 text-[10px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.4)] hover:shadow-[0_0_25px_rgba(34,197,94,0.6)]", activeStyles.list === 'ul' && "bg-green-500/30 border-green-400 shadow-[0_0_25px_rgba(34,197,94,0.7)]")}
                    >
                      <List className="w-3.5 h-3.5 mr-2" /> {t('editorHTML.docEditor.bullets')}
                    </Button>
                    <Button
                      variant="ghost"
                      onMouseDown={(e) => { e.preventDefault(); toggleList('ol'); }}
                      className={cn("flex-1 h-8 text-[10px] font-medium text-white border border-green-400 bg-gradient-to-b from-white/15 to-transparent hover:bg-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.4)] hover:shadow-[0_0_25px_rgba(34,197,94,0.6)]", activeStyles.list === 'ol' && "bg-green-500/30 border-green-400 shadow-[0_0_25px_rgba(34,197,94,0.7)]")}
                    >
                      <List className="w-3.5 h-3.5 mr-2" /> {t('editorHTML.docEditor.numbers')}
                    </Button>
                  </div>
                </div>

                {/* Espaciados (Simulados vía Estilos CSS) */}
                <div className="space-y-4 pt-4 border-t border-gray-800">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-gray-500 flex items-center gap-2"><ArrowUpDown className="w-3 h-3" /> {t('editorHTML.docEditor.lineHeight')}</Label>
                    <Slider min={1} max={3} step={0.1} defaultValue={[1.6]} onValueChange={(v) => applyStyleToSelection('lineHeight', v[0].toString())} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase text-gray-500 flex items-center gap-2"><Plus className="w-3 h-3" /> {t('editorHTML.docEditor.letterSpacing')}</Label>
                    <Slider min={-2} max={10} step={0.5} defaultValue={[0]} onValueChange={(v) => applyStyleToSelection('letterSpacing', `${v[0]}px`)} />
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <div className="p-4 border-t border-gray-800">
              <Button
                onClick={handleQuickSave}
                disabled={isSavingProject}
                className="w-full h-12 text-[11px] font-black uppercase tracking-[0.2em] text-yellow-400 border-2 border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10 shadow-[0_0_20px_rgba(234,179,8,0.1)] hover:shadow-[0_0_30px_rgba(234,179,8,0.2)] hover:border-yellow-500/50 transition-all duration-500 rounded-xl"
              >
                {isSavingProject ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('editorHTML.docEditor.saving')}
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    {t('editorHTML.docEditor.saveChanges')}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Área Principal de Escritura Rico */}
        <div className="flex-1 flex flex-col bg-[#0a0c10] relative overflow-hidden">
          {isPdf ? (
            <div className="flex-1 h-full flex flex-col items-center p-8 overflow-auto custom-scrollbar">
              <div
                className="transition-transform duration-300 origin-top flex flex-col items-center"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                <div className="bg-white shadow-2xl transition-all duration-300 origin-top border-[12px] border-gray-800 rounded-sm" style={{ width: '100%', maxWidth: '1000px', aspectRatio: '1/1.414', height: 'auto' }}>
                  <iframe src={`${resolvedDocumentUrl}#toolbar=1&view=FitH&navpanes=1`} className="w-full h-full border-none" title="PDF Pro" />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 h-full flex flex-col overflow-hidden w-full">
              {/* Regla Superior Fija (Sincronizada con Zoom) */}
              <div className="bg-gray-800 border-b border-gray-700 h-10 flex items-center justify-center shrink-0 overflow-hidden">
                <div
                  id="ruler-container"
                  className="relative h-6 transition-all duration-300"
                  style={{ width: `${(paperDimensions.width * 50) * (zoom / 100)}px` }}
                >
                  <div className="absolute inset-0 flex pointer-events-none">
                    {Array.from({ length: Math.ceil(paperDimensions.width * 10) + 1 }, (_, i) => {
                      const isCentimeter = i % 10 === 0;
                      const isHalfCentimeter = i % 5 === 0 && !isCentimeter;
                      let markHeight = isCentimeter ? 'h-3' : isHalfCentimeter ? 'h-2' : 'h-1';
                      const leftPosition = (i / (paperDimensions.width * 10)) * 100;
                      const centimeterValue = i / 10;
                      if (centimeterValue > paperDimensions.width) return null;
                      return (
                        <div key={i} className={`absolute ${markHeight} w-px bg-gray-500`} style={{ left: `${leftPosition}%`, bottom: '0' }}>
                          {isCentimeter && (
                            <span className="absolute -top-4 left-0 -translate-x-1/2 text-[8px] text-gray-400 font-mono">
                              {centimeterValue}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="absolute left-0 bottom-0 top-0 w-px bg-yellow-500/60 z-30" />
                  <div className="absolute right-0 bottom-0 top-0 w-px bg-yellow-500/60 z-30" />
                  <div className="absolute bottom-0 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-yellow-500 cursor-ew-resize z-40" style={{ left: `${margins.left * (zoom / 100)}px`, transform: 'translateX(-50%)' }} onMouseDown={(e) => { e.stopPropagation(); setDraggingMargin('left'); }} />
                  <div className="absolute bottom-0 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[8px] border-t-yellow-500 cursor-ew-resize z-40" style={{ right: `${margins.right * (zoom / 100)}px`, transform: 'translateX(50%)' }} onMouseDown={(e) => { e.stopPropagation(); setDraggingMargin('right'); }} />
                </div>
              </div>

              <div
                className="flex-1 overflow-auto custom-scrollbar flex flex-col items-center py-8"
                onMouseDown={handleMouseDownPaper}
              >
                {/* Contenedor de Escalado para Zoom (Solo Hoja) */}
                <div
                  className="transition-transform duration-300 origin-top flex flex-col items-center"
                  style={{ transform: `scale(${zoom / 100})` }}
                >
                  {/* Hoja de documento simulada */}
                  <div
                    className="bg-gray-900/40 border border-gray-800 shadow-2xl transition-all duration-300 relative flex flex-col mx-auto shrink-0"
                    style={{
                      width: `${paperDimensions.width * 50}px`,
                      minHeight: `${paperDimensions.height * 50}px`, // Proporción real escalada
                      maxWidth: 'none',
                      cursor: (isDrawingTextMode || isDrawingLineMode) ? 'crosshair' : 'text'
                    }}
                    onClick={() => !selectedElement && editorRef.current?.focus()}
                  >
                    {/* Cuadro de previsualización de dibujo */}
                    {isDrawing && isDrawingLineMode && (
                      <div
                        className="absolute z-50 pointer-events-none"
                        style={{
                          left: linePreview.left,
                          top: linePreview.top - shapeStyle.thickness / 2,
                          width: linePreview.width,
                          height: shapeStyle.thickness,
                          backgroundColor: shapeStyle.bg,
                          transform: `rotate(${linePreview.angle}deg)`,
                          transformOrigin: '0 50%'
                        }}
                      />
                    )}
                    {isDrawing && !isDrawingLineMode && (
                      <div
                        className="absolute border-2 border-green-500 bg-green-500/10 z-50 pointer-events-none"
                        style={{
                          top: drawRect.top,
                          left: drawRect.left,
                          width: drawRect.width,
                          height: drawRect.height
                        }}
                      />
                    )}

                    {/* Líneas Guía de Márgenes (Sincronizadas con el estado) */}
                    <div
                      className="absolute top-0 bottom-0 w-px border-l border-dashed border-gray-700/50 pointer-events-none z-0"
                      style={{ left: `${margins.left}px` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 w-px border-l border-dashed border-gray-700/50 pointer-events-none z-0"
                      style={{ right: `${margins.right}px` }}
                    />

                    <div
                      ref={editorRef}
                      contentEditable="true"
                      suppressContentEditableWarning={true}
                      onInput={(e) => {
                        setHtmlContent(e.currentTarget.innerHTML);
                      }}
                      onKeyDown={(e) => {
                        // Eliminamos el stopPropagation del Enter para que funcionen las listas
                        //
                        // Cuadro de texto (shape-textbox): el contentEditable está anidado
                        // dentro del editor principal y sus hijos hermano son handles no
                        // editables (contenteditable="false"). Con esa estructura, el Enter
                        // por defecto del navegador (insertParagraph) colapsa el caret al
                        // principio del cuadro en vez de partir la línea. Lo evitamos
                        // insertando un <br> a mano en la posición del caret y moviendo el
                        // cursor detrás. Sólo actuamos cuando el caret está dentro de un
                        // .shape-textbox; el resto del editor (listas, párrafos) usa el
                        // comportamiento nativo.
                        if (e.key === 'Enter') {
                          const target = e.target as HTMLElement;
                          if (target.closest && target.closest('.shape-textbox')) {
                            if (e.defaultPrevented) return; // ya lo manejó el onkeydown nativo del cuadro
                            e.preventDefault();
                            const sel = window.getSelection();
                            if (!sel || !sel.rangeCount) return;
                            const range = sel.getRangeAt(0);
                            range.deleteContents();
                            const br = document.createElement('br');
                            range.insertNode(br);
                            // Si el <br> queda como último nodo del cuadro, la nueva línea
                            // no se renderiza vacía; añadimos un segundo <br> "marcador" y
                            // colocamos el caret entre ambos.
                            if (!br.nextSibling) {
                              const extra = document.createElement('br');
                              br.parentNode!.insertBefore(extra, br.nextSibling);
                            }
                            range.setStartAfter(br);
                            range.collapse(true);
                            sel.removeAllRanges();
                            sel.addRange(range);
                            handleContentChange(editorRef.current?.innerHTML || '');
                          }
                        }
                      }}
                      onMouseUp={checkActiveStyles}
                      onKeyUp={(e) => {
                        checkActiveStyles();
                        if (e.key === ' ' || e.key === 'Enter') {
                          handleContentChange(editorRef.current?.innerHTML || '');
                        }
                      }}
                      className="editor-content flex-1 w-full bg-transparent text-gray-300 outline-none leading-relaxed relative z-10"
                      style={{
                        fontFamily: fontFamily,
                        fontSize: `${fontSize}px`,
                        paddingLeft: `${margins.left}px`,
                        paddingRight: `${margins.right}px`,
                        paddingTop: '48px',
                        paddingBottom: '80px'
                      }}
                    />

                    {/* Indicador de Número de Página */}
                    <div className="absolute bottom-6 left-0 right-0 flex justify-center pointer-events-none">
                      <div className="bg-gray-800/80 backdrop-blur-sm border border-gray-700/50 px-4 py-1.5 rounded-full flex items-center gap-2 shadow-xl transition-all duration-500">
                        <span className="text-[10px] uppercase font-black tracking-widest text-gray-500">{t('editorHTML.docEditor.page')}</span>
                        <span className="text-sm font-black text-yellow-400 font-mono">{currentPageIndex + 1}</span>
                        <span className="text-[10px] text-gray-600">/</span>
                        <span className="text-[10px] font-bold text-gray-600">{pages.length}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={isSaveModalOpen} onClose={() => setIsSaveModalOpen(false)} title={<span className="text-yellow-400">{t('editorHTML.docEditor.saveProjectBtn')}</span>} size="md">
        <SaveDocumentProjectForm onSave={saveProjectLocal} onClose={() => setIsSaveModalOpen(false)} isSaving={isSavingProject} />
      </Modal>

      <Modal isOpen={isLoadModalOpen} onClose={() => setIsLoadModalOpen(false)} title={<span className="text-blue-400">{t('editorHTML.docEditor.loadProjectBtn')}</span>} size="lg">
        <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {savedProjects.length === 0 && <p className="text-center py-8 text-gray-500 italic">{t('editorHTML.docEditor.noProjectsFound')}</p>}
          {savedProjects.map(p => (
            <div key={p.id} className="flex items-center justify-between p-4 bg-gray-800 border border-gray-700 rounded-xl hover:border-blue-500 cursor-pointer" onClick={() => p.isLocal ? handleOpenLocalProject(p) : loadProjectFromRecord(p)}>
              <div className="flex items-center gap-4">
                <FileText className="w-5 h-5 text-yellow-400" />
                <div>
                  <h4 className="font-bold text-yellow-400 text-sm">{p.titulo}</h4>
                  <p className="text-[10px] text-blue-400 font-bold uppercase tracking-tighter opacity-80">
                    {p.isLocal ? t('editorHTML.docEditor.localLocation') : `ID: ${p.id.slice(-4)}`}
                  </p>
                </div>
              </div>
              {!p.isLocal && (
                <button onClick={(e) => { e.stopPropagation(); if (confirm(t('editorHTML.docEditor.deleteConfirm'))) pb.collection('proyectos').delete(p.id).then(fetchProjectsFromPocketBase); }} className="p-2 text-gray-500 hover:text-red-500 transition-all">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </Modal>

      <Modal isOpen={isUploaderOpen} onClose={() => { setIsUploaderOpen(false); setPbLoadStep('collection'); setSelectedPbRecordFiles(null); setSelectedPbCollection(null); setFileNotAllowedMessage(null); }} title={pbLoadStep === 'local' ? t('editorHTML.docEditor.loadLocalFileTitle') : pbLoadStep === 'collection' ? t('editorHTML.docEditor.selectCollection') : pbLoadStep === 'record' ? t('editorHTML.docEditor.selectRecord') : t('editorHTML.docEditor.selectFile')} size="lg">
        <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto text-white">
          <p className="text-xs text-gray-500 mb-4">{t('editorHTML.docEditor.onlyAllowedFiles')}</p>

          {fileNotAllowedMessage && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm mb-4">{fileNotAllowedMessage}</div>
          )}

          {pbLoadStep === 'local' ? (
            <div className="grid grid-cols-1 gap-2">
              {pbLoading && <p className="text-center py-8 text-gray-500">{t('editorHTML.docEditor.searchingLocal')}</p>}
              {!pbLoading && localFolderFiles.length === 0 && (
                <p className="text-center py-8 text-gray-500 italic">{t('editorHTML.docEditor.noFilesInFolder')}</p>
              )}
              {localFolderFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-4 bg-gray-800 border border-gray-700/50 rounded-xl hover:bg-gray-700 hover:border-yellow-500/50 cursor-pointer transition-all"
                  onClick={() => addOneDocumentFromPb({ url: `${getMediaUrl(f.path)}`, fileName: f.name })}
                >
                  <FileCode className="w-5 h-5 text-yellow-400" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-white block truncate">{f.name}</span>
                    <p className="text-[9px] text-gray-500 uppercase tracking-tighter">{t('editorHTML.docEditor.localFile')}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {pbLoadStep === 'record' && (
                <button type="button" onClick={() => { setPbLoadStep('collection'); setSelectedPbCollection(null); setPbRecords([]); }} className="flex items-center gap-2 text-gray-400 hover:text-white mb-2">
                  <ChevronLeft className="w-4 h-4" /> {t('editorHTML.docEditor.backToCollections')}
                </button>
              )}
              {pbLoadStep === 'file' && (
                <button type="button" onClick={() => { setPbLoadStep('record'); setSelectedPbRecordFiles(null); }} className="flex items-center gap-2 text-gray-400 hover:text-white mb-2">
                  <ChevronLeft className="w-4 h-4" /> {t('editorHTML.docEditor.backToRecords')}
                </button>
              )}
              {pbLoadStep === 'collection' && (
                <>
                  {pbLoading && pbCollections.length === 0 && <p className="text-center py-8 text-gray-500">{t('editorHTML.docEditor.loadingCollections')}</p>}
                  {pbCollections.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer mb-2" onClick={() => fetchPbRecordsForCollection(c.name)}>
                      <Folder className="w-5 h-5 text-amber-500" />
                      <span className="font-medium text-white">{c.name}</span>
                    </div>
                  ))}
                </>
              )}
              {pbLoadStep === 'record' && (
                <>
                  {pbLoading && pbRecords.length === 0 && <p className="text-center py-8 text-gray-500">{t('editorHTML.docEditor.loadingRecords')}</p>}
                  {pbRecords.map((r) => (
                    <div key={r.recordId} className="flex items-center gap-3 p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer mb-2" onClick={() => selectPbRecordForFiles(r)}>
                      <FileText className="w-5 h-5 text-yellow-400" />
                      <div>
                        <span className="font-medium text-white">{r.recordName}</span>
                        <p className="text-[10px] text-gray-500">{t('editorHTML.docEditor.fileCount', { n: r.files.length })}</p>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {pbLoadStep === 'file' && selectedPbRecordFiles && (
                <>
                  {selectedPbRecordFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-3 p-4 bg-gray-800 rounded-xl hover:bg-gray-700 cursor-pointer mb-2" onClick={() => addOneDocumentFromPb(f)}>
                      <FileText className="w-5 h-5 text-yellow-400" />
                      <span className="font-medium text-white truncate">{cleanDisplayFileName(f.fileName)}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
