import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import type { PrintJob, PrintJobStatus } from './printerRepository';

export type InstallerRegister = {
  id: string; code: string; name: string; isDefault: boolean; isActive: boolean;
};
export type InstallerPrinter = {
  id: string; registerId: string; displayName: string;
  hardwareIdentifier: string; paperWidthMm: 58 | 80; isDefault: boolean; isActive: boolean;
};
export type InstallerDevices = {
  appointmentId: string; tenantId: string; branchId: string;
  registers: InstallerRegister[]; printers: InstallerPrinter[];
};
type DeviceAction =
  | 'devices' | 'get_job' | 'create_register' | 'register_printer' | 'request_test' | 'transition_test';
type CommandAction = Exclude<DeviceAction, 'devices' | 'get_job'>;

export async function loadInstallationDevices(appointmentId: string): Promise<InstallerDevices> {
  const value = await invoke(appointmentId,'devices',{});
  if (!Array.isArray(value.registers) || !Array.isArray(value.printers)
      || typeof value.tenantId !== 'string' || typeof value.branchId !== 'string') {
    throw new Error('Invalid installation-device response.');
  }
  return value as InstallerDevices;
}

export async function loadInstallationTestJob(appointmentId: string, jobId: string): Promise<PrintJob> {
  const value = await invoke(appointmentId,'get_job',{jobId});
  return asTestJob(value);
}

export async function createInstallationRegister(input:{
  appointmentId:string; code:string; name:string;
}): Promise<{registerId:string}> {
  const value = await command(input.appointmentId,'create_register',{
    code:input.code.trim().toUpperCase(),name:input.name.trim(),
  });
  if(typeof value.registerId !== 'string')throw new Error('Invalid saved register response.');
  return {registerId:value.registerId};
}

export async function registerInstallationPrinter(input:{
  appointmentId:string; registerId:string; displayName:string;
  hardwareIdentifier:string; paperWidthMm:58|80;
}): Promise<{printerId:string}> {
  const value = await command(input.appointmentId,'register_printer',{
    registerId:input.registerId,displayName:input.displayName.trim(),
    hardwareIdentifier:input.hardwareIdentifier.trim().toUpperCase(),
    paperWidthMm:input.paperWidthMm,
  });
  if(typeof value.printerId !== 'string')throw new Error('Invalid saved printer response.');
  return {printerId:value.printerId};
}

export async function requestInstallationTestPrint(
  appointmentId:string,printerId:string,
): Promise<PrintJob> {
  const value=await command(appointmentId,'request_test',{printerId});
  return asTestJob(value);
}

export async function transitionInstallationTestPrint(
  appointmentId:string,jobId:string,status:'printing'|'printed'|'failed',
  failureMessage?:string,
): Promise<{jobId:string;status:PrintJobStatus}> {
  const value=await command(appointmentId,'transition_test',{
    jobId,status,...(status==='failed'?{failureMessage:failureMessage||'Printer test failed'}:{}),
  });
  if(typeof value.jobId!=='string' || typeof value.status!=='string')
    throw new Error('Invalid native test-print status.');
  return {jobId:value.jobId,status:value.status as PrintJobStatus};
}

async function invoke(appointmentId:string,action:DeviceAction,payload:Record<string,unknown>,
  commandId?:string):Promise<Record<string,unknown>> {
  const {data,error}=await supabase.functions.invoke('platform-setup-installer',{
    body:{action,appointmentId,payload,...(commandId?{commandId}:{})},
  });
  if(error){
    let detail:string | null=null;
    try{
      const response=error.context as {json?:()=>Promise<{error?:string}>}|undefined;
      if(response?.json)detail=(await response.json()).error??null;
    }catch{/* Use the original transport error when no server error is available. */}
    throw new Error(detail || error.message || 'Installation setup request failed.');
  }
  const outer=data as {result?:unknown}|null;
  if(!outer || !outer.result || typeof outer.result!=='object' || Array.isArray(outer.result))
    throw new Error('SellerTray returned an invalid installation response.');
  return outer.result as Record<string,unknown>;
}

async function command(appointmentId:string,action:CommandAction,
  payload:Record<string,unknown>):Promise<Record<string,unknown>> {
  const {data}=await supabase.auth.getUser();
  const actorId=data.user?.id;
  if(!actorId)throw new Error('Sign in to your ProcessEdge account.');
  const fingerprint=JSON.stringify(payload);
  const key=`sellertray.installer.pending.v1:${actorId}:${appointmentId}:${action}`;
  let pending:{fingerprint:string;commandId:string}|null=null;
  try{
    const previous=await AsyncStorage.getItem(key);
    if(previous)pending=JSON.parse(previous) as {fingerprint:string;commandId:string};
  }catch{/* A missing/corrupt record creates one new command. */}
  const commandId=pending?.fingerprint===fingerprint
    ?pending.commandId :generateCommandId();
  if(!commandId)throw new Error('Unable to create a safe installation command reference.');
  await AsyncStorage.setItem(key,JSON.stringify({fingerprint,commandId}));
  // Unknown network outcomes retain the command ID for safe retry. A completed
  // backend response releases it only after an authoritative result arrives.
  const value=await invoke(appointmentId,action,payload,commandId);
  await AsyncStorage.removeItem(key);
  return value;
}

function generateCommandId():string {
  if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();
  // Non-secret idempotency reference, not an authorization token.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,(c)=>{
    const r=Math.floor(Math.random()*16);
    return(c==='x'?r:((r&3)|8)).toString(16);
  });
}

function asTestJob(value:Record<string,unknown>):PrintJob {
  if(typeof value.jobId!=='string' || value.jobType!=='test'
     || typeof value.printerId!=='string'||typeof value.hardwareIdentifier!=='string'
     || (value.paperWidthMm!==58&&value.paperWidthMm!==80)
     || value.transport!=='bluetooth'||typeof value.printerName!=='string'
     || !['requested','printing','printed','failed'].includes(String(value.status))
     || !value.contentSnapshot||typeof value.contentSnapshot!=='object') {
    throw new Error('SellerTray returned an invalid printer test job.');
  }
  return {
    jobId:value.jobId,
    status:value.status as PrintJobStatus,
    jobType:'test',orderId:null,financialDocumentId:null,
    printerId:value.printerId,printerName:value.printerName,transport:'bluetooth',
    hardwareIdentifier:value.hardwareIdentifier,
    paperWidthMm:value.paperWidthMm,
    contentSnapshot:value.contentSnapshot as PrintJob['contentSnapshot'],
    requestedAt:typeof value.requestedAt==='string'?value.requestedAt:null,
    startedAt:typeof value.startedAt==='string'?value.startedAt:null,
    completedAt:typeof value.completedAt==='string'?value.completedAt:null,
    failedAt:typeof value.failedAt==='string'?value.failedAt:null,
    failureCode:null,failureMessage:null,
    idempotentReplay:value.idempotentReplay===true,
  };
}
