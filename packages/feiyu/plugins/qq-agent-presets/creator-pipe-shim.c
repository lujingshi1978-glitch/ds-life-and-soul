// Compatibility for libuv <=1.52.1 inside Windows AppContainer, upstream #5181.
// Redirect only libuv's own pipe names into the SAME AppContainer's LOCAL
// namespace. No token, ACL, sandbox, environment, or network permission changes.
// Built as a minimal N-API addon; the original node.exe stays byte-identical.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <string.h>
#include <wchar.h>
typedef HANDLE (WINAPI *PipeFn)(LPCWSTR,DWORD,DWORD,DWORD,DWORD,DWORD,DWORD,LPSECURITY_ATTRIBUTES);
static PipeFn original;
typedef HANDLE (WINAPI *PipeAFn)(LPCSTR,DWORD,DWORD,DWORD,DWORD,DWORD,DWORD,LPSECURITY_ATTRIBUTES);
typedef HANDLE (WINAPI *FileAFn)(LPCSTR,DWORD,DWORD,LPSECURITY_ATTRIBUTES,DWORD,DWORD,HANDLE);
typedef HANDLE (WINAPI *FileWFn)(LPCWSTR,DWORD,DWORD,LPSECURITY_ATTRIBUTES,DWORD,DWORD,HANDLE);
static PipeAFn original_a;static FileAFn file_a;static FileWFn file_w;
static int scoped_a(LPCSTR name,char *scoped){const char*prefix="\\\\?\\pipe\\uv\\";if(!name||strncmp(name,prefix,strlen(prefix)))return 0;if(strlen(name)>450)return -1;strcpy(scoped,"\\\\?\\pipe\\LOCAL\\uv\\");strcat(scoped,name+strlen(prefix));return 1;}
static int scoped_w(LPCWSTR name,wchar_t *scoped){const wchar_t*prefix=L"\\\\?\\pipe\\uv\\";if(!name||wcsncmp(name,prefix,wcslen(prefix)))return 0;if(wcslen(name)>450)return -1;wcscpy(scoped,L"\\\\?\\pipe\\LOCAL\\uv\\");wcscat(scoped,name+wcslen(prefix));return 1;}
static HANDLE WINAPI local_pipe_a(LPCSTR name,DWORD o,DWORD p,DWORD i,DWORD b,DWORD c,DWORD t,LPSECURITY_ATTRIBUTES s){char scoped[512];int r=scoped_a(name,scoped);if(r<0){SetLastError(ERROR_FILENAME_EXCED_RANGE);return INVALID_HANDLE_VALUE;}return original_a(r?scoped:name,o,p,i,b,c,t,s);}
static HANDLE WINAPI local_file_a(LPCSTR name,DWORD a,DWORD s,LPSECURITY_ATTRIBUTES d,DWORD m,DWORD f,HANDLE t){char scoped[512];int r=scoped_a(name,scoped);if(r<0){SetLastError(ERROR_FILENAME_EXCED_RANGE);return INVALID_HANDLE_VALUE;}return file_a(r?scoped:name,a,s,d,m,f,t);}
static HANDLE WINAPI local_file_w(LPCWSTR name,DWORD a,DWORD s,LPSECURITY_ATTRIBUTES d,DWORD m,DWORD f,HANDLE t){wchar_t scoped[512];int r=scoped_w(name,scoped);if(r<0){SetLastError(ERROR_FILENAME_EXCED_RANGE);return INVALID_HANDLE_VALUE;}return file_w(r?scoped:name,a,s,d,m,f,t);}
static HANDLE WINAPI local_pipe(LPCWSTR name,DWORD openMode,DWORD pipeMode,DWORD instances,DWORD outSize,DWORD inSize,DWORD timeout,LPSECURITY_ATTRIBUTES security){
 const wchar_t *prefix=L"\\\\?\\pipe\\uv\\";
 if(name&&wcsncmp(name,prefix,wcslen(prefix))==0){
  wchar_t scoped[512];const wchar_t *tail=name+wcslen(prefix);
  if(wcslen(tail)>400){SetLastError(ERROR_FILENAME_EXCED_RANGE);return INVALID_HANDLE_VALUE;}
  wcscpy(scoped,L"\\\\?\\pipe\\LOCAL\\uv\\");wcscat(scoped,tail);
  return original(scoped,openMode,pipeMode,instances,outSize,inSize,timeout,security);
 }
 return original(name,openMode,pipeMode,instances,outSize,inSize,timeout,security);
}
static int install(void){
 HANDLE token;DWORD active=0,size=0;
 if(!OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token))return 1;
 BOOL queried=GetTokenInformation(token,TokenIsAppContainer,&active,sizeof(active),&size);CloseHandle(token);
 if(!queried||!active)return 2;
 BYTE *base=(BYTE*)GetModuleHandleW(NULL);IMAGE_DOS_HEADER *dos=(IMAGE_DOS_HEADER*)base;
 if(dos->e_magic!=IMAGE_DOS_SIGNATURE)return 3;
 IMAGE_NT_HEADERS *nt=(IMAGE_NT_HEADERS*)(base+dos->e_lfanew);
 if(nt->Signature!=IMAGE_NT_SIGNATURE)return 4;
 DWORD offset=nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT].VirtualAddress;if(!offset)return 5;
 IMAGE_IMPORT_DESCRIPTOR *imports=(IMAGE_IMPORT_DESCRIPTOR*)(base+offset);int found=0;
 for(;imports->Name;imports++){
  if(!imports->OriginalFirstThunk)continue;
  IMAGE_THUNK_DATA *names=(IMAGE_THUNK_DATA*)(base+imports->OriginalFirstThunk),*slots=(IMAGE_THUNK_DATA*)(base+imports->FirstThunk);
  for(;names->u1.AddressOfData;names++,slots++){
   if(IMAGE_SNAP_BY_ORDINAL(names->u1.Ordinal))continue;
   IMAGE_IMPORT_BY_NAME *item=(IMAGE_IMPORT_BY_NAME*)(base+names->u1.AddressOfData);
   void *replacement=NULL;void **save=NULL;int bit=0;
   if(!strcmp((char*)item->Name,"CreateNamedPipeW")){replacement=(void*)local_pipe;save=(void**)&original;bit=1;}
   if(!strcmp((char*)item->Name,"CreateNamedPipeA")){replacement=(void*)local_pipe_a;save=(void**)&original_a;bit=2;}
   if(!strcmp((char*)item->Name,"CreateFileA")){replacement=(void*)local_file_a;save=(void**)&file_a;bit=4;}
   if(!strcmp((char*)item->Name,"CreateFileW")){replacement=(void*)local_file_w;save=(void**)&file_w;bit=8;}
   if(!replacement)continue;found|=bit;if((void*)slots->u1.Function==replacement)continue;
   DWORD protection;*save=(void*)(uintptr_t)slots->u1.Function;
   if(!VirtualProtect(&slots->u1.Function,sizeof(void*),PAGE_READWRITE,&protection))return 6;
   InterlockedExchangePointer((PVOID volatile*)&slots->u1.Function,replacement);
   DWORD ignored;if(!VirtualProtect(&slots->u1.Function,sizeof(void*),protection,&ignored))return 7;
  }
 }
 return (found&6)==6?0:8;
}
typedef void* napi_env;typedef void* napi_value;
typedef int (*ThrowFn)(napi_env,const char*,const char*);
__declspec(dllexport) napi_value napi_register_module_v1(napi_env env,napi_value exports){
 int result=install();if(result){ThrowFn fail=(ThrowFn)GetProcAddress(GetModuleHandleW(NULL),"napi_throw_error");if(fail)fail(env,"CREATOR_PIPE_SHIM_FAILED","Creator pipe compatibility failed; do not run outside the container.");return NULL;}return exports;
}
