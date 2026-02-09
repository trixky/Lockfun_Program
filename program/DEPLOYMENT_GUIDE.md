# Guide: Déploiement Correct d'un Program Solana avec Anchor

## ⚠️ Problème Rencontré

Lors du déploiement initial, Anchor a généré un nouveau keypair avec un Program ID différent de celui déclaré dans le code (`declare_id!()`), créant un mismatch.

## 🔍 Pourquoi ça arrive ?

Anchor génère automatiquement un keypair dans `target/deploy/` si il n'existe pas. Si le `declare_id!()` dans le code ne correspond pas au keypair, Anchor ne le détecte pas toujours automatiquement et peut déployer avec un Program ID différent.

## ✅ Solution : Workflow Correct de Déploiement

### Méthode 1 : Synchroniser les clés AVANT le build (Recommandé)

```bash
cd program

# 1. Vérifier/créer le keypair si nécessaire
anchor keys list

# 2. Synchroniser le declare_id avec le keypair
anchor keys sync

# 3. Vérifier que tout correspond
anchor keys list

# 4. Builder
anchor build

# 5. Vérifier que le Program ID dans l'IDL correspond
grep '"address"' target/idl/lockfun.json

# 6. Déployer
anchor deploy --provider.cluster mainnet
```

### Méthode 2 : Utiliser un Program ID spécifique dès le début

Si vous voulez utiliser un Program ID spécifique :

```bash
# 1. Générer un nouveau keypair avec un Program ID spécifique
solana-keygen new -o target/deploy/lockfun-keypair.json

# 2. Obtenir le Program ID
solana-keygen pubkey target/deploy/lockfun-keypair.json

# 3. Mettre à jour le declare_id dans lib.rs
# declare_id!("VOTRE_PROGRAM_ID_ICI");

# 4. Mettre à jour Anchor.toml
# [programs.mainnet]
# lockfun = "VOTRE_PROGRAM_ID_ICI"

# 5. Builder
anchor build

# 6. Vérifier que tout correspond
anchor keys list

# 7. Déployer
anchor deploy --provider.cluster mainnet
```

## 🛡️ Checklist Avant Déploiement

Avant de déployer sur mainnet, TOUJOURS vérifier :

```bash
# 1. Vérifier le Program ID dans le code source
grep "declare_id" programs/lockfun/src/lib.rs

# 2. Vérifier le Program ID du keypair
solana-keygen pubkey target/deploy/lockfun-keypair.json

# 3. Vérifier le Program ID dans Anchor.toml
grep "lockfun" Anchor.toml

# 4. Vérifier le Program ID dans l'IDL généré
grep '"address"' target/idl/lockfun.json

# 5. TOUS doivent correspondre !
```

## 💰 Coûts : Upgrade vs Delete + Redeploy

### Upgrade
- Coût : ~2.3 SOL (buffer account + transaction)
- Avantages : 
  - Conserve le même Program ID
  - Conserve l'historique
  - Plus rapide
- Inconvénients :
  - Plus cher que le déploiement initial

### Delete + Redeploy
- Coût : ~1 SOL (déploiement initial)
- Récupération : ~2.27 SOL (rent du program account)
- Net : **Vous récupérez ~1.27 SOL**
- Avantages :
  - Moins cher au final
  - Fresh start
- Inconvénients :
  - **Nouveau Program ID** (casse la compatibilité)
  - Perd l'historique
  - Tous les comptes PDAs deviennent invalides

## ⚠️ ATTENTION : Delete + Redeploy

**NE PAS DELETE si :**
- Le program est déjà utilisé en production
- Des comptes PDAs existent déjà
- D'autres contracts dépendent de ce Program ID
- Vous voulez garder le même Program ID

**OK pour DELETE si :**
- C'est un nouveau déploiement
- Aucun compte n'existe encore
- Vous pouvez changer le Program ID

## 🔧 Script de Vérification Automatique

Utilisez le script `verify-before-deploy.sh` pour vérifier automatiquement avant chaque déploiement.
