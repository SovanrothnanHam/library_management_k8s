# Library Management System on Kubernetes (Minikube)

Five microservices (API Gateway, Login, Registration, Librarian, Member) deployed on
Minikube with **YAML files only**, MongoDB **Atlas** (cloud) as the database, an
**NGINX Ingress** on the domain `ourlibrary.com`, and a **shared Kubernetes volume** for logs.

How this guide is organised:

| Part | What you do | Steps |
|---|---|---|
| **A** | Install requirements and run/test each microservice on your computer | 1 - 8 |
| **B** | Build Docker images and push them to Docker Hub | 9 - 11 |
| **C** | Deploy to Kubernetes (Minikube), Ingress, volume, final tests | 12 - 22 |

Commands are for **Windows PowerShell**. Mac/Linux differences are noted. Run every command
from the **project root** (the folder that contains `services`, `k8s` and this README) unless the step says `cd`.

---

## 0. Security warning (read first)

Your original zip had real MongoDB Atlas credentials in the `.env` files and in the `.git`
history, and the folders had no `.dockerignore`, so `COPY . .` copied `.env` **into your Docker
images**. This project removes all of that: no `.git`, `.dockerignore` added to every service,
and in Kubernetes the secrets live in a Secret file that is in `.gitignore`.

**Before you push anything to Docker Hub or GitHub:** MongoDB Atlas, **Database Access**, edit your
user, **set a new password**. That makes any old image or commit that contains the old password useless.

---

## 1. Project structure

```
Library_Management_K8s/
├── services/                          <- code + Dockerfile of the 5 microservices
│   ├── API_Gateway_Microservice/         port 3000   (modified: can write a log file)
│   ├── Registration_Microservice/        port 3001   (also holds seed-librarian.js)
│   ├── Login_Microservice/               port 3002
│   ├── Librarian_Microservice/           port 3003
│   └── Member_Microservice/              port 3004
│        each has: index.js, package.json, Dockerfile, .dockerignore, .env.example
├── k8s/                               <- ALL Kubernetes YAML
│   ├── deployments/                      <- the PODS (one Deployment per file)
│   │   ├── registration.yaml
│   │   ├── gateway-login.yaml               1 Pod, 3 containers: gateway + login + nginx log viewer (shared volume)
│   │   ├── librarian.yaml
│   │   └── member.yaml                      2 replicas
│   ├── services/                         <- the SERVICES (one Service per file)
│   │   ├── registration-service.yaml
│   │   ├── gateway-service.yaml
│   │   ├── log-viewer-service.yaml          2nd branch of the fanout (/logs)
│   │   ├── librarian-service.yaml
│   │   └── member-service.yaml
│   ├── ingress.yaml                      Fanout DNS (ourlibrary.com)
│   ├── seed-librarian-job.yaml           one-time Job: creates the librarian account
│   └── shared-volume-demo.yaml           nginx + debian sharing an emptyDir volume
├── secrets/library-secret.template.yaml  <- you copy this to k8s/library-secret.yaml (Step 13)
├── scripts/build-push.ps1 | .sh          <- builds + pushes all 5 images in one command
├── postman/Library_K8s.postman_collection.json
├── docs/REPORT_TEMPLATE.md               <- project report outline + viva questions
└── README.md
```

## 2. Architecture

```
Postman / Browser
      │  http://ourlibrary.com/...
      ▼
 Ingress (NGINX)   ONE domain -> TWO different Services  (fanout)
      │
      ├─ /register /auth /librarian /member /health ─► gateway-service :3000 ─┐
      │                                                                        │
      └─ /logs ───────────────────────────────────────► log-viewer-service :80 ┤
                                                                               ▼
                       ┌──────────────── Pod: gateway-login ──────────────────┐
                       │ api-gateway :3000 ──► login :3002  (localhost)       │
                       │      │ writes                                         │
                       │      ▼                                                │
                       │  emptyDir volume "app-logs"  (gateway-log.txt)        │
                       │      ▲ reads (read-only)                              │
                       │ log-viewer (nginx :80)                                │
                       └──────┬────────────────────────────────────────────────┘
                              ├──► registration-service :3001 ──► Pod registration
                              ├──► librarian-service    :3003 ──► Pod librarian
                              └──► member-service       :3004 ──► Pod member x2 (load balanced)

All microservices ──► MongoDB Atlas (cloud database, URI comes from the Secret)
```

## 3. Requirements checklist (instructions -> where it is done)

| # | Requirement | Where | Proof |
|---|---|---|---|
| 1 | Deploy with YAML only | every file in `k8s/deployments/`, `k8s/services/`, `k8s/` and `secrets/` | the YAML files, `kubectl get all` |
| 2 | Multiple Pods | 4 Deployments, 3 containers in `gateway-login`, 2 `member` replicas | `kubectl get pods` |
| 3 | Everything through the API Gateway | all Services are ClusterIP, every business API path in the Ingress points to the gateway, services reject calls without the gateway secret | Step 19 |
| 4 | Cloud database | MongoDB Atlas, URI from the Secret, no DB container | logs: `MongoDB connected successfully` |
| 5 | Fanout DNS with a domain | `k8s/ingress.yaml`: host `ourlibrary.com` fans out to 2 Services (`gateway-service` and `log-viewer-service`) | `kubectl get ingress`, Postman URLs, `/logs` in the browser |
| 6 | Volume shared by containers | `emptyDir` `app-logs`: gateway writes, nginx log viewer reads the same file + `shared-volume-demo.yaml` | Step 20 |
| 7 | Local deployment on Minikube | Part C | dashboard screenshots |

> **Requirements 3 and 5 together:** one domain fans out to two different Services. The API paths go to
> the API Gateway (which checks the JWT + role and forwards to the microservices). `/logs` goes to a
> read-only nginx log viewer that shows the shared volume. Clients never reach registration, login,
> librarian or member directly, so requirement 3 still holds. The log viewer is not a microservice.

---

# PART A: Run and test each microservice locally

## Step 1: Install the requirements

| Tool | Why | Check command |
|---|---|---|
| **Node.js 22 LTS or newer** (npm included) | run the services | `node -v` and `npm -v` |
| **Docker Desktop** (running) | build images | `docker --version` |
| **Minikube** | local Kubernetes | `minikube version` |
| **kubectl** | talk to Kubernetes | `kubectl version --client` |
| **Postman** | test APIs | open the app |
| Docker Hub account | store your images | log in at hub.docker.com |
| MongoDB Atlas account | cloud database | log in at cloud.mongodb.com |

## Step 2: MongoDB Atlas (cloud database)

1. Atlas, **Network Access**, **Add IP Address**, enter `0.0.0.0/0` (allow from anywhere, fine for a class demo).
   Without this, neither your computer nor the Kubernetes pods can connect.
2. Atlas, **Database Access**: use your database user with the **new password** from Section 0.
3. Atlas, **Connect**, **Drivers**, copy the connection string and add the database name `librarydb`:
   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/librarydb?retryWrites=true&w=majority
   ```
   If the password has special characters (`@ : / ? #`), URL-encode them (e.g. `@` becomes `%40`).

## Step 3: Install node modules for each microservice

Run these once. Each command installs the exact versions from `package-lock.json`.

```powershell
cd services\Registration_Microservice
npm install
cd ..\..

cd services\Login_Microservice
npm install
cd ..\..

cd services\Librarian_Microservice
npm install
cd ..\..

cd services\Member_Microservice
npm install
cd ..\..

cd services\API_Gateway_Microservice
npm install
cd ..\..
```

| Microservice | Packages it installs |
|---|---|
| Registration | express, mongoose, bcryptjs, dotenv |
| Login | express, mongoose, bcryptjs, jsonwebtoken, dotenv |
| Librarian | express, mongoose, dotenv |
| Member | express, mongoose, dotenv |
| API Gateway | express, http-proxy, jsonwebtoken, dotenv |

(Mac/Linux: same commands with `/` instead of `\`.)

## Step 4: Create the `.env` file of each microservice (local only)

Each service has a `.env.example`. Copy it to `.env`, then edit.

```powershell
Copy-Item services\Registration_Microservice\.env.example services\Registration_Microservice\.env
Copy-Item services\Login_Microservice\.env.example        services\Login_Microservice\.env
Copy-Item services\Librarian_Microservice\.env.example    services\Librarian_Microservice\.env
Copy-Item services\Member_Microservice\.env.example       services\Member_Microservice\.env
Copy-Item services\API_Gateway_Microservice\.env.example  services\API_Gateway_Microservice\.env
```
(Mac/Linux: `cp` instead of `Copy-Item`.)

Edit the values:

| File | What to set |
|---|---|
| `Registration`, `Login`, `Librarian`, `Member` `.env` | `MONGO_URI` = your Atlas string from Step 2 |
| **All five** `.env` | `GATEWAY_SECRET` must be the **same text** in all 5 files |
| `Login` and `API_Gateway` `.env` | `JWT_SECRET` must be the **same text** in both files |

The ports (3000 to 3004) and the gateway's `*_SERVICE_URL` values are already correct for local runs.
`.env` files are in `.gitignore` and `.dockerignore`: they never go to GitHub or into an image.

## Step 5: Start every microservice (one terminal each)

Open **5 PowerShell terminals**, one per service, and start the four microservices first, the gateway last.

| Terminal | Commands | You should see |
|---|---|---|
| 1 Registration | `cd services\Registration_Microservice` then `npm start` | `Registration Microservice running on port 3001` and `MongoDB connected successfully: librarydb` |
| 2 Login | `cd services\Login_Microservice` then `npm start` | `Login Microservice running on port 3002` and `MongoDB connected successfully` |
| 3 Librarian | `cd services\Librarian_Microservice` then `npm start` | `Librarian Microservice running on port 3003` and `MongoDB connected successfully` |
| 4 Member | `cd services\Member_Microservice` then `npm start` | `Member Microservice running on port 3004` and `MongoDB connected successfully` |
| 5 Gateway | `cd services\API_Gateway_Microservice` then `npm start` | `API Gateway is running on port 3000` |

If a service shows `MongoDB connection failed`, check Step 2 (Network Access) and the `MONGO_URI` in its `.env`.

## Step 6: Create the librarian account (once)

Registration only creates members. Create the librarian (role `admin`) with the seed script, in a **new terminal**:

```powershell
cd services\Registration_Microservice
node seed-librarian.js
```
Expected: `Librarian created: librarian@library.com` (password from `LIBRARIAN_PASSWORD` in that `.env`).

## Step 7: Test the APIs through the gateway

1. `curl.exe http://localhost:3000/health` should print `{"status":"ok","service":"api-gateway"}`.
2. Postman, **Import**, `postman/Library_K8s.postman_collection.json`.
3. Open the collection, **Variables** tab, set `baseUrl` current value to `http://localhost:3000`, **Save**.
4. Run the requests in this order:

| Order | Request | Expected |
|---|---|---|
| 1 | Register member | `201` |
| 2 | Login as member | `200` + token (saved automatically) |
| 3 | Login as librarian | `200` + token |
| 4 | Librarian: Add book | `201` |
| 5 | Member: View all books, Search books, **Borrow book**, My history | `200` / `201` |
| 6 | Librarian: View borrowed books, **Mark returned**, View members | `200` |
| 7 | Security checks (no token, member token on librarian API, unknown route) | `401` / `403` / `404` |

## Step 8: Prove the microservices block direct access

Call the Member service **directly** (skipping the gateway):
```powershell
curl.exe -i http://localhost:3004/member/viewallbooks
```
Expected: `403` with `Direct access blocked. Please call this API through the API Gateway.`

Everything works locally. Stop all 5 terminals with `Ctrl + C`.
If you ran the gateway with `LOG_FILE` set, delete the `gateway-log.txt` file it created.

---

# PART B: Docker images

## Step 9: Log in to Docker Hub and build the 5 images

Replace `rothnan` with **your** Docker Hub username everywhere. Make sure Docker Desktop is running.

```powershell
docker login
```

**Fast way (one command, builds and pushes all 5):**
```powershell
.\scripts\build-push.ps1 -DockerUser rothnan
```
(Mac/Linux: `./scripts/build-push.sh rothnan`). If you use this, skip to Step 11.

**Manual way (one image at a time):**
```powershell
docker build -t rothnan/lib-k8s-registration:1.1 . services\Registration_Microservice
docker build -t rothnan/lib-k8s-login:1.1 .     services\Login_Microservice
docker build -t rothnan/lib-k8s-librarian:1.1 .    services\Librarian_Microservice
docker build -t rothnan/lib-k8s-member:1.1 .      services\Member_Microservice
docker build -t rothnan/lib-k8s-gateway:1.1 .     services\API_Gateway_Microservice
docker images
```

## Step 10: (Optional) Test one image as a container

This is the "run image as a container" check from your class activity. The `.env` from Step 4 is
passed in at run time (it is **not** inside the image):
```powershell
docker run --rm -p 3001:3001 --env-file services\Registration_Microservice\.env rothnan/lib-k8s-registration:1.1
```
You should see `MongoDB connected successfully`. Stop it with `Ctrl + C`.

## Step 11: Push the images to Docker Hub

Skip this if you used the fast way in Step 9.
```powershell
docker push rothnan/lib-k8s-registration:1.1
docker push rothnan/lib-k8s-login:1.1
docker push rothnan/lib-k8s-librarian:1.1
docker push rothnan/lib-k8s-member:1.1
docker push rothnan/lib-k8s-gateway:1.1
```
On hub.docker.com make sure the 5 repositories are **public** so Minikube can pull them.

**If your Docker Hub username is not `rothnan`**, change it in all YAML files:
```powershell
Get-ChildItem k8s -Recurse -Filter *.yaml | ForEach-Object { (Get-Content $_) -replace 'rothnan/','YOURUSER/' | Set-Content $_ }
```

> Screenshot: Docker Hub showing the 5 images (or the push output).

---

# PART C: Kubernetes on Minikube

## Step 12: Start Minikube, the dashboard and the Ingress controller

```powershell
minikube start --driver=docker
minikube addons enable ingress
minikube dashboard
```
`minikube dashboard` opens the browser: **keep that terminal open** and use a **new terminal** for the next steps.
```powershell
kubectl get nodes
kubectl get pods -n ingress-nginx
```
> Screenshot: `minikube start` output, ingress-nginx controller pod `Running`, the dashboard.

## Step 13: Create the Secret (database URL + keys)

```powershell
Copy-Item secrets\library-secret.template.yaml k8s\library-secret.yaml
notepad k8s\library-secret.yaml
```
(Mac/Linux: `cp secrets/library-secret.template.yaml k8s/library-secret.yaml`)

Fill in `MONGO_URI` (Step 2), and set `JWT_SECRET` and `GATEWAY_SECRET` to any long random text. Save, then:
```powershell
kubectl apply -f k8s\library-secret.yaml
kubectl get secret library-secret
```
This file is in `.gitignore`. Never commit it and never screenshot it unblurred.

## Step 14: Deploy the Pods (Deployments) and the Services

The YAML is split in two folders: `k8s\deployments` (the Pods) and `k8s\services` (the networking).

**Deployments (Pods):**
```powershell
kubectl apply -f k8s\deployments\registration.yaml
kubectl apply -f k8s\deployments\gateway-login.yaml
kubectl apply -f k8s\deployments\librarian.yaml
kubectl apply -f k8s\deployments\member.yaml
```
**Services:**
```powershell
kubectl apply -f k8s\services\registration-service.yaml
kubectl apply -f k8s\services\gateway-service.yaml
kubectl apply -f k8s\services\log-viewer-service.yaml
kubectl apply -f k8s\services\librarian-service.yaml
kubectl apply -f k8s\services\member-service.yaml
```
(Shortcut: `kubectl apply -f k8s\deployments` and `kubectl apply -f k8s\services` apply a whole folder.)

Watch until everything is `Running`:
```powershell
kubectl get pods
kubectl get deployments
kubectl get services
```
`gateway-login` must show `3/3` (gateway, login, log viewer) and `member` must show 2 pods. Check the cloud database connection:
```powershell
kubectl logs deployment/registration
kubectl logs deployment/librarian
kubectl logs deployment/member
kubectl logs deployment/gateway-login -c login-container
```
Each should print `MongoDB connected successfully: librarydb`.

> Screenshots: the deployment YAML files, the service YAML files, `get pods`, `get deployments`, `get services`, the "connected" logs,
> and the dashboard pages **Deployments**, **Pods**, **Services**.

**Dashboard alternative:** in the dashboard click **+** (top right), **Create from file**, and upload the
same files in this order: `library-secret.yaml`, the 4 files in `deployments`, the 5 files in `services`,
then `ingress.yaml`, `seed-librarian-job.yaml`, `shared-volume-demo.yaml`. Keep the namespace set to `default`.

## Step 15: Create the librarian account in the cloud database (once)

If you already ran Step 6 against the same Atlas database, the librarian exists and this Job just says
`already exists`. Otherwise run it:
```powershell
kubectl apply -f k8s\seed-librarian-job.yaml
kubectl logs job/seed-librarian
```
Login later with `librarian@library.com`, the `LIBRARIAN_PASSWORD` from your Secret, role `admin`.
To run it again: `kubectl delete job seed-librarian` then apply again.

## Step 16: Ingress (Fanout DNS)

```powershell
kubectl apply -f k8s\ingress.yaml
kubectl get ingress
kubectl describe ingress library-ingress
```
> Screenshot: `ingress.yaml`, `kubectl get ingress`.

## Step 17: Add the domain name to your hosts file

Open **Notepad as Administrator**, open `C:\Windows\System32\drivers\etc\hosts`, add this line at the bottom, save:
```
127.0.0.1   ourlibrary.com
```
(Mac/Linux: `sudo nano /etc/hosts`, same line. If you are **not** using the Docker driver, use the output of
`minikube ip` instead of `127.0.0.1` and skip Step 18.)

## Step 18: Start the tunnel and test the domain

Open a **separate PowerShell as Administrator** (Mac/Linux: `sudo minikube tunnel`) and keep it open:
```powershell
minikube tunnel
```
In your normal terminal:
```powershell
curl.exe http://ourlibrary.com/health
```
Expected: `{"status":"ok","service":"api-gateway"}`

This is the **first branch** of the fanout (the API Gateway). Now the **second branch** (the log viewer):
```powershell
curl.exe http://ourlibrary.com/logs/gateway-log.txt
```
Expected: a line like `... API Gateway started on port 3000`. It comes from a different Service (`log-viewer-service`).

> Screenshots: the hosts file line, `http://ourlibrary.com/health` and `http://ourlibrary.com/logs/gateway-log.txt` in the browser.

## Step 19: Test every API through the domain

1. In Postman, set the collection variable `baseUrl` back to `http://ourlibrary.com` and **Save**.
2. Run the same order as Step 7 (register, login member, login librarian, add book, view/search/borrow,
   mark returned, security checks). Every URL should show `ourlibrary.com`.
3. **Prove direct access is blocked** from inside the cluster:
   ```powershell
   kubectl run curl-test --rm -it --restart=Never --image=curlimages/curl -- curl -i http://member-service:3004/member/viewallbooks
   ```
   Expected: `403 ... Direct access blocked`. Also `kubectl get services` shows only ClusterIP (no NodePort, no external IP).
4. **Prove load balancing:** send "Member: View all books" 5-6 times and look at the response header
   `X-Served-By`. It shows different Member pod names. Compare with `kubectl get pods -l app=member`.

> Screenshots: Postman (blur the tokens), the 401/403 checks, the `403 Direct access blocked` output,
> two responses with different `X-Served-By`.

## Step 20: Kubernetes Volume shared by containers

The gateway writes every request to `/var/log/app/gateway-log.txt` on the `app-logs` volume.
The `log-viewer` (nginx) container in the **same Pod** mounts the **same volume** (read-only) at
`/usr/share/nginx/html/logs`, and the Ingress shows it at `/logs`. Same file, two containers, two mount paths.

1. Make a few API calls in Postman (Step 19).
2. Open `http://ourlibrary.com/logs/gateway-log.txt` in the browser (or `curl.exe` it). Your calls appear as
   lines like `POST /auth/login [public] -> http://127.0.0.1:3002`. Make another call and refresh: a new line appears.
3. Show the same file from both containers with kubectl:
```powershell
$POD = kubectl get pod -l app=gateway-login -o jsonpath='{.items[0].metadata.name}'

kubectl exec $POD -c api-gateway-container -- cat /var/log/app/gateway-log.txt
kubectl exec $POD -c log-viewer-container  -- cat /usr/share/nginx/html/logs/gateway-log.txt
kubectl describe pod $POD
```
Both `cat` commands print identical content. In `describe`, find `Volumes: app-logs (EmptyDir)` and the
`Mounts:` of the gateway container (read-write) and the log-viewer container (read-only).

> Screenshots: the volume parts of `deployments\gateway-login.yaml`, the browser at `/logs/gateway-log.txt`,
> both `cat` outputs, `describe pod` with the volume.

**Second demo: nginx + debian (same as Class Activity 11):**
```powershell
kubectl apply -f k8s\shared-volume-demo.yaml
kubectl get pod shared-volume-demo
kubectl describe pod shared-volume-demo
kubectl exec shared-volume-demo -c nginx-container  -- cat /usr/share/nginx/html/index.html
kubectl exec shared-volume-demo -c debian-container -- cat /shared-dir/index.html
```
Both outputs are identical (a new line every 60 seconds). This Pod uses `restartPolicy: Never`.

> Screenshots: the volume section of `gateway-login.yaml`, the commands above, `describe pod` showing the volume.

## Step 21: Extra demos (optional, good for the presentation)

```powershell
# Self-healing: delete ONE member pod, Kubernetes creates a new one immediately
$M = kubectl get pod -l app=member -o jsonpath='{.items[0].metadata.name}'
kubectl delete pod $M
kubectl get pods -l app=member

# Scaling: change "replicas: 2" to 3 in k8s\deployments\member.yaml, then
kubectl apply -f k8s\deployments\member.yaml
kubectl get pods -l app=member
```

## Step 22: Clean up when finished

```powershell
kubectl delete -f k8s\shared-volume-demo.yaml -f k8s\seed-librarian-job.yaml -f k8s\ingress.yaml -f k8s\services -f k8s\deployments -f k8s\library-secret.yaml
minikube stop        # or: minikube delete
```

---

## Useful commands

| Task | Command |
|---|---|
| All resources | `kubectl get all` |
| Logs of a container | `kubectl logs deployment/member` or `kubectl logs <pod> -c api-gateway-container` |
| Follow gateway logs | `kubectl logs deployment/gateway-login -c api-gateway-container -f` |
| Pod details / errors | `kubectl describe pod <pod-name>` |
| Shell in a container | `kubectl exec -it <pod> -c login-container -- sh` |
| Restart after a new image or Secret | `kubectl rollout restart deployment/member` |
| Apply after editing YAML | `kubectl apply -f k8s\deployments\<file>.yaml` (or `k8s\services\...`) |

If you change a microservice's code: build and push a new tag (e.g. `1.2`), update the `image:` line
in its YAML, and `kubectl apply` it again.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `npm install` fails | Node.js too old. Run `node -v` and install Node 22 LTS or newer. |
| Local: `MongoDB connection failed` | Atlas Network Access missing `0.0.0.0/0`, or wrong/unencoded password in `MONGO_URI`. |
| Local: `403 Direct access blocked` through the gateway | `GATEWAY_SECRET` differs between the `.env` files. Make all 5 identical and restart. |
| Local: `401 Invalid token` | `JWT_SECRET` differs between Login and Gateway `.env`. |
| Pod `CreateContainerConfigError` | The Secret is missing (Step 13), then `kubectl rollout restart deployment/<name>`. |
| Pod `ImagePullBackOff` | Wrong Docker Hub username in the YAML, image not pushed, or repo is private. See `kubectl describe pod <pod>`. |
| Pod log: `MongoDB connection failed` | Atlas Network Access, or wrong `MONGO_URI` in the Secret. Fix it, `kubectl apply -f k8s\library-secret.yaml`, then `kubectl rollout restart deployment/<name>`. |
| `http://ourlibrary.com` does not open | `minikube tunnel` is not running (needs Administrator), hosts line missing, or the ingress addon is not enabled. |
| `kubectl apply -f k8s\ingress.yaml` fails with `failed calling webhook ... validate.nginx.ingress.kubernetes.io` | The ingress controller is still starting. Wait until `kubectl get pods -n ingress-nginx` shows the controller `1/1 Running`, then apply again. |
| `/logs/gateway-log.txt` shows `404` | The gateway has not written the file yet. Check `kubectl get pods` (`3/3`), and that the gateway image is the `1.1` one built from this project (old images have no file logging). |
| `/logs/` (no file name) shows `403` | Directory listing is off on purpose. Use the full path `/logs/gateway-log.txt`. |
| Plain NGINX `404` page (not JSON) | The path is not in the Ingress. Routed paths: `/register /auth /librarian /member /health /logs`. |
| `502 ... target microservice is not reachable` | That microservice Pod is not `Running` yet (`kubectl get pods`). |
| Librarian login gives 401 | Seed not run (Step 6 or 15), wrong password, or role is not `admin`. |
| Seed Job: `already exists` on re-apply | `kubectl delete job seed-librarian`, then apply again. |
| Hosts file cannot be saved | Notepad was not opened as Administrator. |

## Final screenshot checklist

- [ ] All 5 microservices running locally and the Postman tests passing (Part A)
- [ ] The 5 images on Docker Hub
- [ ] `minikube start`, ingress-nginx running, dashboard open
- [ ] YAML files: the 4 in `deployments`, the 5 in `services`, and `ingress`
- [ ] `kubectl get pods`, `get deployments`, `get services` (all ClusterIP), `get ingress`
- [ ] Logs showing `MongoDB connected successfully` (cloud database)
- [ ] Dashboard: Deployments, Pods, Services
- [ ] Hosts file line + `http://ourlibrary.com/health` and `/logs/gateway-log.txt` in the browser
- [ ] Postman through `ourlibrary.com`: register, login, add book, borrow, mark returned
- [ ] 401 / 403 checks + `403 Direct access blocked` from inside the cluster
- [ ] Two responses with different `X-Served-By` (load balancing)
- [ ] Shared volume: log file in the browser at `/logs/gateway-log.txt`, both `cat` outputs, `describe pod` volume
- [ ] nginx + debian demo: both `cat` outputs identical

Blur JWT tokens, the MongoDB URI and passwords in every screenshot.

For the written report (architecture, YAML files, steps, screenshots, test results, challenges, conclusion)
use `docs/REPORT_TEMPLATE.md`.
